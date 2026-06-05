/**
 * syncWhenTallyUp.js
 * Polls Tally every 30 seconds until it responds, then runs the full import.
 * Usage: node scripts/syncWhenTallyUp.js
 */
import dotenv      from 'dotenv';
import axios       from 'axios';
import connectDB   from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';
import Vendor      from '../models/Vendor.js';
import Client      from '../models/Client.js';
import AccountsLedger from '../models/AccountsLedger.js';

dotenv.config();

const BATCH   = 200;
const TIMEOUT = 120000;

const decode = s => {
  if (!s) return '';
  let v = String(s);
  for (let i = 0; i < 2; i++)
    v = v.replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'");
  return v.trim();
};
const gVal  = (b,t) => b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'))?.[1]?.trim() || '';
const gGuid = b => b.match(/<GUID>(.*?)<\/GUID>/i)?.[1]?.trim() || null;
const gAlt  = b => b.match(/<ALTERID[^>]*>(.*?)<\/ALTERID>/i)?.[1]?.trim() || null;
const normPhone = raw => {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g,'');
  if (d.length===12&&d.startsWith('91')) d=d.slice(2);
  if (d.length===11&&d.startsWith('0'))  d=d.slice(1);
  return d.length>=7 ? d.slice(0,15) : '';
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tryFetch(url, company) {
  const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME>
<STATICVARIABLES>
  <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  try {
    const r = await axios({ method:'POST', url, data:xml,
      headers:{'Content-Type':'text/xml',Accept:'*/*'},
      timeout:TIMEOUT, responseType:'text', validateStatus:()=>true,
      maxContentLength:Infinity, maxBodyLength:Infinity });
    const body = typeof r.data==='string' ? r.data : String(r.data||'');
    if (r.status===200 && body.includes('<LEDGER')) return body;
    console.log(`  Tally not ready (HTTP ${r.status}, ${body.length} bytes) — retrying in 30s...`);
    return null;
  } catch(e) {
    console.log(`  Tally unreachable: ${e.message} — retrying in 30s...`);
    return null;
  }
}

async function importLedgers(resp) {
  const matches = [...resp.matchAll(/<LEDGER[^>]*NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)];
  console.log(`\n  Found ${matches.length} ledgers`);
  let vIns=0, cIns=0, lIns=0, counter=0;

  for (let i=0; i<matches.length; i+=BATCH) {
    const ledgerOps=[], vendorOps=[], clientOps=[];
    for (const m of matches.slice(i,i+BATCH)) {
      const name    = decode(m[1]?.trim()); if (!name) continue;
      const block   = m[2]||'';
      const guid    = gGuid(block);
      const alterId = gAlt(block);
      const parent  = decode(gVal(block,'PARENT'));
      const isCred  = /creditor|sundry.c/i.test(parent);
      const isDebt  = /debtor|sundry.d/i.test(parent);

      const gstNum        = decode(gVal(block,'PARTYGSTIN')) || 'N/A';
      const openingBal    = parseFloat(gVal(block,'OPENINGBALANCE')) || 0;
      const email         = decode(gVal(block,'EMAIL'));
      const phone         = normPhone(decode(gVal(block,'LEDGERMOBILE')));
      const contactPerson = decode(gVal(block,'MAILINGNAME')) || name;

      const addrLines = [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)]
        .map(a=>decode(a[1].trim())).filter(Boolean);
      let city    = decode(gVal(block,'LEDGERCITY'));
      let state   = decode(gVal(block,'STATENAME')||gVal(block,'LEDGERSTATE'));
      let pincode = decode(gVal(block,'PINCODE')||gVal(block,'LEDGERPINCODE')).replace(/\D/g,'').slice(0,6);
      const country = decode(gVal(block,'COUNTRYNAME')) || 'India';
      const addrStr = addrLines.slice(0,2).join(', ');

      if (!city||!state) {
        for (const ln of addrLines) {
          const pm=ln.match(/\b(\d{6})\b/);
          if (pm) {
            if (!pincode) pincode=pm[1];
            const pts=ln.replace(pm[0],'').replace(/[-,\s]+$/,'').split(/[,\-]/).map(p=>p.trim()).filter(Boolean);
            if (!city&&pts[0]) city=pts[0];
            if (!state&&pts[1]) state=pts[1];
            break;
          }
        }
      }

      const safeEmail = email||`${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;
      const safePhone = phone||'0000000000';
      const ledgerGroup = isCred?'Sundry Creditors':isDebt?'Sundry Debtors':(parent||'General');
      const ledgerCode  = `TALLY-${name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,20)}-${counter++}`;

      ledgerOps.push({updateOne:{
        filter: guid?{tallyGuid:guid}:{ledgerName:name},
        update:{
          $set:{ ledgerGroup, gstNumber:gstNum, openingBalance:openingBal,
            syncedWithTally:true, lastTallySync:new Date(),
            ...(email?{email}:{}), ...(phone?{phone}:{}),
            ...(addrStr?{'address.street':addrStr}:{}), ...(city?{'address.city':city}:{}),
            ...(state?{'address.state':state}:{}), ...(pincode?{'address.pincode':pincode}:{}),
            ...(country?{'address.country':country}:{}),
            ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
          $setOnInsert:{ ledgerCode, ledgerName:name, contactPerson, panNumber:'N/A', isActive:true },
        }, upsert:true,
      }});

      if (!isCred&&!isDebt) continue;

      if (isCred) {
        vendorOps.push({updateOne:{
          filter: guid?{tallyGuid:guid}:{companyName:name},
          update:{
            $set:{ tallySynced:true, lastTallySync:new Date(),
              ...(phone?{phone}:{}), ...(email?{email:safeEmail}:{}),
              ...(contactPerson?{contactPerson}:{}),
              ...(addrStr?{address:addrStr}:{}), ...(city?{city}:{}),
              ...(state?{state}:{}), ...(pincode?{pincode}:{}),
              ...(gstNum!=='N/A'?{gstNumber:gstNum}:{}),
              ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
            $setOnInsert:{ vendorId:`VND-TALLY-${Date.now()%1000000}-${vendorOps.length}`,
              companyName:name, category:'General', contactPerson:contactPerson||name,
              phone:safePhone, email:safeEmail,
              address:addrStr||'Imported from Tally', city:city||'Unknown',
              state:state||'Unknown', pincode:pincode||'000000', status:'Active' },
          }, upsert:true,
        }});
      } else {
        clientOps.push({updateOne:{
          filter: guid?{tallyGuid:guid}:{name},
          update:{
            $set:{ tallySynced:true, lastTallySync:new Date(),
              ...(phone?{phone}:{}), ...(email?{email:safeEmail}:{}),
              ...(contactPerson?{contact:contactPerson}:{}),
              ...(addrStr?{address:addrStr}:{}), ...(city?{city}:{}),
              ...(gstNum!=='N/A'?{gstNumber:gstNum}:{}),
              ...(guid?{tallyGuid:guid}:{}), ...(alterId?{tallyAlterId:alterId}:{}) },
            $setOnInsert:{ clientId:`CLT-TALLY-${Date.now()%1000000}-${clientOps.length}`,
              name, contact:contactPerson||name, phone:safePhone, email:safeEmail,
              city:city||'Unknown', category:'Trading', status:'Active' },
          }, upsert:true,
        }});
      }
    }

    const [lr,vr,cr] = await Promise.all([
      ledgerOps.length ? AccountsLedger.bulkWrite(ledgerOps,{ordered:false}).catch(e=>{console.error('\n  L err:',e.message);return null;}) : null,
      vendorOps.length ? Vendor.bulkWrite(vendorOps,{ordered:false}).catch(e=>{console.error('\n  V err:',e.message);return null;}) : null,
      clientOps.length ? Client.bulkWrite(clientOps,{ordered:false}).catch(e=>{console.error('\n  C err:',e.message);return null;}) : null,
    ]);
    lIns += lr?(lr.upsertedCount||0)+(lr.modifiedCount||0):0;
    vIns += vr?(vr.upsertedCount||0)+(vr.modifiedCount||0):0;
    cIns += cr?(cr.upsertedCount||0)+(cr.modifiedCount||0):0;

    process.stdout.write(`\r  Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(matches.length/BATCH)} → Ledgers:${lIns} Vendors:${vIns} Clients:${cIns}   `);
    await sleep(30);
  }
  return { lIns, vIns, cIns };
}

async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Tally → MongoDB: Waiting for Tally then importing...');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await connectDB();

  const cfg      = await TallyConfig.findOne();
  const tallyUrl = cfg?.tallyLocalUrl?.trim() || process.env.TALLY_LOCAL_URL || 'https://erp.majesticmall.net';
  const company  = cfg?.companyName?.trim()   || process.env.TALLY_COMPANY   || 'SRI CHAKRA INDUSTRIES';

  console.log(`Tally URL : ${tallyUrl}`);
  console.log(`Company   : ${company}`);
  console.log('\nWaiting for Tally to be reachable...');

  let resp = null;
  while (!resp) {
    resp = await tryFetch(tallyUrl, company);
    if (!resp) await sleep(30000);
  }

  console.log('\n✅ Tally is UP — starting import...');
  const { lIns, vIns, cIns } = await importLedgers(resp);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ DONE — Ledgers: ${lIns} | Vendors: ${vIns} | Clients: ${cIns}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

main().catch(e => { console.error('\n❌ Fatal:', e.message); process.exit(1); });
