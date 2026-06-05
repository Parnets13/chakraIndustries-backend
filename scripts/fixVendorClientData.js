/**
 * fixVendorClientData.js
 *
 * One-time fix script: re-pulls ledger data from Tally and updates all vendors/clients
 * with correct phone, city, state, address, contact person.
 * Also fixes HTML entity encoding (&amp; → &) in company names.
 *
 * Usage: node scripts/fixVendorClientData.js
 */

import dotenv  from 'dotenv';
import axios   from 'axios';
import connectDB    from '../config/database.js';
import TallyConfig  from '../models/TallyConfig.js';
import Vendor       from '../models/Vendor.js';
import Client       from '../models/Client.js';

dotenv.config();

const TIMEOUT = 90000;

// ── Helpers ───────────────────────────────────────────────────────────────────
const gVal = (b,t) => b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'))?.[1]?.trim() || '';
const gGuid = b => b.match(/<GUID>(.*?)<\/GUID>/i)?.[1]?.trim() || null;

function decodeXml(s) {
  if (!s) return '';
  let v = String(s);
  for (let i = 0; i < 2; i++) {
    v = v.replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&apos;/gi,"'");
  }
  return v;
}

function normPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g,'');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0'))  d = d.slice(1);
  return d.length === 10 ? d : d.slice(0,15) || '';
}

async function post(url, xml) {
  for (let i = 1; i <= 3; i++) {
    try {
      process.stdout.write(`\r   Attempt ${i}... `);
      const r = await axios({ method:'POST', url, data:xml,
        headers:{'Content-Type':'text/xml',Accept:'*/*'},
        timeout: TIMEOUT, responseType:'text', validateStatus:()=>true,
        maxContentLength: Infinity, maxBodyLength: Infinity,
      });
      const body = typeof r.data === 'string' ? r.data : String(r.data||'');
      console.log(`OK (${body.length} bytes)`);
      return body;
    } catch(e) {
      console.log(`✗ ${e.message}`);
      if (i < 3) await new Promise(r=>setTimeout(r,3000));
    }
  }
  return '';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await connectDB();
  const cfg = await TallyConfig.findOne();
  if (!cfg) { console.error('No TallyConfig found'); process.exit(1); }

  const tallyUrl   = (cfg.tallyLocalUrl||'').trim() || 'https://erp.majesticmall.net';
  const company    = (cfg.companyName||'').trim()   || 'SRI CHAKRA INDUSTRIES';

  console.log(`Tally URL  : ${tallyUrl}`);
  console.log(`Company    : ${company}`);

  // ── STEP 1: Fix HTML entities in existing vendor/client names ────────────────
  console.log('\n━━ STEP 1: Fixing &amp; entities in existing vendor/client names ━━');
  const vendors = await Vendor.find({ companyName: /&amp;/i });
  console.log(`  Found ${vendors.length} vendors with &amp; in name`);
  for (const v of vendors) {
    const fixed = decodeXml(v.companyName);
    const fixedContact = decodeXml(v.contactPerson);
    await Vendor.findByIdAndUpdate(v._id, { companyName: fixed, contactPerson: fixedContact });
    console.log(`  Fixed: "${v.companyName}" → "${fixed}"`);
  }

  const clients = await Client.find({ name: /&amp;/i });
  console.log(`  Found ${clients.length} clients with &amp; in name`);
  for (const c of clients) {
    const fixed = decodeXml(c.name);
    await Client.findByIdAndUpdate(c._id, { name: fixed, contact: decodeXml(c.contact) });
    console.log(`  Fixed: "${c.name}" → "${fixed}"`);
  }

  // ── STEP 2: Re-pull Ledgers from Tally ──────────────────────────────────────
  console.log('\n━━ STEP 2: Re-pulling ledgers from Tally ━━');
  const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Accounts</REPORTNAME>
<STATICVARIABLES>
  <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
  <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
</STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;

  const resp = await post(tallyUrl, xml);
  if (!resp || resp.length < 100) {
    console.error('No response from Tally — aborting step 2');
    process.exit(0);
  }

  const matches = [...resp.matchAll(/<LEDGER[^>]*NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)];
  console.log(`  Found ${matches.length} ledger entries`);

  let vUpdated = 0, cUpdated = 0;

  const BATCH = 200;
  for (let i = 0; i < matches.length; i += BATCH) {
    const vendorOps = [], clientOps = [];
    for (const m of matches.slice(i, i+BATCH)) {
      const name   = decodeXml(m[1]?.trim()); if (!name) continue;
      const block  = m[2]||'';
      const guid   = gGuid(block);
      const parent = decodeXml(gVal(block,'PARENT'));
      const isCred = /creditor|sundry.c/i.test(parent);
      const isDebt = /debtor|sundry.d/i.test(parent);
      if (!isCred && !isDebt) continue;

      const phone         = decodeXml(gVal(block,'LEDGERMOBILE'));
      const email         = decodeXml(gVal(block,'EMAIL'));
      const contactPerson = decodeXml(gVal(block,'MAILINGNAME'));
      const gstNum        = decodeXml(gVal(block,'PARTYGSTIN'));

      // Address
      const addrLines = [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)].map(a=>decodeXml(a[1].trim())).filter(Boolean);
      let city    = decodeXml(gVal(block,'LEDGERCITY'));
      let state   = decodeXml(gVal(block,'STATENAME')||gVal(block,'LEDGERSTATE'));
      let pincode = decodeXml(gVal(block,'PINCODE')||gVal(block,'LEDGERPINCODE')).replace(/\D/g,'').slice(0,6);
      const addrStr = addrLines.slice(0,2).join(', ');

      if (!city || !state) {
        for (const line of addrLines) {
          const pm = line.match(/\b(\d{6})\b/);
          if (pm) {
            if (!pincode) pincode = pm[1];
            const parts = line.replace(pm[0],'').replace(/[-,\s]+$/,'').split(/[,\-]/).map(p=>p.trim()).filter(Boolean);
            if (!city  && parts[0]) city  = parts[0];
            if (!state && parts[1]) state = parts[1];
            break;
          }
        }
      }

      const sp = normPhone(phone);
      const se = email || `${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;

      const setFields = {
        ...(sp               ? { phone:    sp }   : {}),
        ...(email            ? { email:    se }   : {}),
        ...(contactPerson    ? { contactPerson }   : {}),
        ...(addrStr          ? { address:  addrStr } : {}),
        ...(city             ? { city }             : {}),
        ...(state            ? { state }            : {}),
        ...(pincode          ? { pincode }          : {}),
        ...(gstNum && gstNum !== 'N/A' ? { gstNumber: gstNum } : {}),
        companyName: name,  // also fix decoded name
        tallySynced: true, lastTallySync: new Date(),
      };

      if (isCred) {
        vendorOps.push({ updateOne:{
          filter: guid ? {tallyGuid:guid} : {companyName: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'i') }},
          update: { $set: setFields },
        }});
      } else {
        const clientSet = {
          ...(sp            ? { phone:   sp } : {}),
          ...(email         ? { email:   se } : {}),
          ...(contactPerson ? { contact: contactPerson } : {}),
          ...(addrStr       ? { address: addrStr } : {}),
          ...(city          ? { city }              : {}),
          ...(gstNum && gstNum !== 'N/A' ? { gstNumber: gstNum } : {}),
          name,
          tallySynced: true, lastTallySync: new Date(),
        };
        clientOps.push({ updateOne:{
          filter: guid ? {tallyGuid:guid} : {name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`,'i') }},
          update: { $set: clientSet },
        }});
      }
    }

    if (vendorOps.length) {
      const r = await Vendor.bulkWrite(vendorOps, {ordered:false}).catch(e=>{console.error('V err:',e.message);return null;});
      vUpdated += r ? (r.modifiedCount||0) : 0;
    }
    if (clientOps.length) {
      const r = await Client.bulkWrite(clientOps, {ordered:false}).catch(e=>{console.error('C err:',e.message);return null;});
      cUpdated += r ? (r.modifiedCount||0) : 0;
    }

    process.stdout.write(`\r  Batch ${Math.floor(i/BATCH)+1}/${Math.ceil(matches.length/BATCH)} — Vendors updated:${vUpdated}  Clients updated:${cUpdated}   `);
  }

  console.log(`\n\n✅ Done! Vendors updated: ${vUpdated} | Clients updated: ${cUpdated}`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
