/**
 * deleteAndResync.js
 * 1. Deletes ALL Vendor and Client documents from MongoDB
 * 2. Re-pulls all ledgers from Tally and imports them fresh
 *    with correct phone, city, address, contact person (decoded)
 *
 * Usage: node scripts/deleteAndResync.js
 */

import dotenv      from 'dotenv';
import axios       from 'axios';
import connectDB   from '../config/database.js';
import TallyConfig from '../models/TallyConfig.js';
import Vendor      from '../models/Vendor.js';
import Client      from '../models/Client.js';
import AccountsLedger from '../models/AccountsLedger.js';

dotenv.config();

const TIMEOUT = 120000; // 2 min — large ledger list can be slow
const BATCH   = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────
const gVal = (b, t) =>
  b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'))?.[1]?.trim() || '';

const gGuid = b =>
  b.match(/<GUID>(.*?)<\/GUID>/i)?.[1]?.trim() || null;

const gAlt = b =>
  b.match(/<ALTERID[^>]*>(.*?)<\/ALTERID>/i)?.[1]?.trim() || null;

/** Two-pass XML entity decoder — handles single and double encoding */
function decode(s) {
  if (!s) return '';
  let v = String(s);
  for (let i = 0; i < 2; i++) {
    v = v
      .replace(/&amp;/gi,  '&')
      .replace(/&lt;/gi,   '<')
      .replace(/&gt;/gi,   '>')
      .replace(/&quot;/gi, '"')
      .replace(/&apos;/gi, "'");
  }
  return v.trim();
}

/** Normalise Indian phone numbers to 10 digits */
function normPhone(raw) {
  if (!raw) return '';
  let d = String(raw).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0'))  d = d.slice(1);
  return d.length >= 7 ? d.slice(0, 15) : '';
}

/** Post XML to Tally with 3 retries */
async function postXml(url, xml) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      process.stdout.write(`\r   → Attempt ${attempt}/3 ... `);
      const r = await axios({
        method: 'POST', url, data: xml,
        headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
        timeout: TIMEOUT,
        responseType: 'text',
        validateStatus: () => true,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      const body = typeof r.data === 'string' ? r.data : String(r.data || '');
      console.log(`HTTP ${r.status} (${body.length} bytes)`);
      if (body.length > 100) return body;
    } catch (e) {
      console.log(`✗ ${e.message}`);
    }
    if (attempt < 3) await new Promise(r => setTimeout(r, 4000));
  }
  return '';
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(' Delete All Vendors/Clients → Fresh Tally Sync');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  await connectDB();

  // Read Tally config from DB (same as the running server uses)
  const cfg       = await TallyConfig.findOne();
  const tallyUrl  = cfg?.tallyLocalUrl?.trim() || process.env.TALLY_LOCAL_URL || 'https://erp.majesticmall.net';
  const company   = cfg?.companyName?.trim()   || process.env.TALLY_COMPANY   || 'SRI CHAKRA INDUSTRIES';

  console.log(`\nTally URL : ${tallyUrl}`);
  console.log(`Company   : ${company}`);

  // ── STEP 1: Delete existing data ──────────────────────────────────────────
  console.log('\n━━ STEP 1: Deleting existing Vendors, Clients, AccountsLedgers ━━');

  const [vDel, cDel, lDel] = await Promise.all([
    Vendor.deleteMany({}),
    Client.deleteMany({}),
    AccountsLedger.deleteMany({}),
  ]);

  console.log(`  ✅ Deleted: ${vDel.deletedCount} vendors | ${cDel.deletedCount} clients | ${lDel.deletedCount} ledgers`);

  // ── STEP 2: Pull ledgers from Tally ───────────────────────────────────────
  console.log('\n━━ STEP 2: Fetching all ledgers from Tally ━━');

  const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC>
  <REPORTNAME>List of Accounts</REPORTNAME>
  <STATICVARIABLES>
    <SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  const resp = await postXml(tallyUrl, xml);

  if (!resp || resp.length < 200) {
    console.error('\n❌ No response from Tally. Check that Tally is running and the HTTP server is enabled.');
    process.exit(1);
  }

  const matches = [...resp.matchAll(/<LEDGER[^>]*NAME="([^"]+)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)];
  console.log(`  Found ${matches.length} ledgers in Tally response`);

  if (!matches.length) {
    console.error('❌ Zero ledgers found — aborting.');
    process.exit(1);
  }

  // ── STEP 3: Parse and insert ───────────────────────────────────────────────
  console.log('\n━━ STEP 3: Importing vendors & clients ━━');

  let vInserted = 0, cInserted = 0, lInserted = 0;
  let counter   = 0;

  for (let i = 0; i < matches.length; i += BATCH) {
    const ledgerOps = [], vendorOps = [], clientOps = [];

    for (const m of matches.slice(i, i + BATCH)) {
      const name   = decode(m[1]?.trim()); if (!name) continue;
      const block  = m[2] || '';
      const guid   = gGuid(block);
      const alterId = gAlt(block);
      const parent = decode(gVal(block, 'PARENT'));
      const isCred = /creditor|sundry.c/i.test(parent);
      const isDebt = /debtor|sundry.d/i.test(parent);

      // ── Parse all fields ──────────────────────────────────────────────────
      const gstNum        = decode(gVal(block, 'PARTYGSTIN'))  || 'N/A';
      const openingBal    = parseFloat(gVal(block, 'OPENINGBALANCE')) || 0;
      const email         = decode(gVal(block, 'EMAIL'));
      const phoneRaw      = decode(gVal(block, 'LEDGERMOBILE'));
      const contactPerson = decode(gVal(block, 'MAILINGNAME')) || name;
      const phone         = normPhone(phoneRaw);

      // Address lines
      const addrLines = [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)]
        .map(a => decode(a[1].trim())).filter(Boolean);

      let city    = decode(gVal(block, 'LEDGERCITY'));
      let state   = decode(gVal(block, 'STATENAME') || gVal(block, 'LEDGERSTATE'));
      let pincode = decode(gVal(block, 'PINCODE')   || gVal(block, 'LEDGERPINCODE')).replace(/\D/g, '').slice(0, 6);
      const country = decode(gVal(block, 'COUNTRYNAME')) || 'India';

      // Fallback: derive city/state/pincode from address lines
      if (!city || !state) {
        for (const line of addrLines) {
          const pm = line.match(/\b(\d{6})\b/);
          if (pm) {
            if (!pincode) pincode = pm[1];
            const parts = line.replace(pm[0], '').replace(/[-,\s]+$/, '')
              .split(/[,\-]/).map(p => p.trim()).filter(Boolean);
            if (!city  && parts[0]) city  = parts[0];
            if (!state && parts[1]) state = parts[1];
            break;
          }
        }
      }

      const addrStr   = addrLines.slice(0, 2).join(', ');
      const safeEmail = email || `${name.replace(/\s+/g, '').toLowerCase().slice(0, 30)}@tally.sync`;
      const safePhone = phone || '0000000000';

      const ledgerGroup = isCred ? 'Sundry Creditors' : isDebt ? 'Sundry Debtors' : (parent || 'General');
      const ledgerCode  = `TALLY-${name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 20)}-${counter++}`;

      // AccountsLedger
      ledgerOps.push({ updateOne: {
        filter: guid ? { tallyGuid: guid } : { ledgerName: name },
        update: {
          $set: {
            ledgerGroup, gstNumber: gstNum, openingBalance: openingBal,
            syncedWithTally: true, lastTallySync: new Date(),
            ...(email   ? { email }                        : {}),
            ...(phone   ? { phone }                        : {}),
            ...(addrStr ? { 'address.street': addrStr }   : {}),
            ...(city    ? { 'address.city':   city }       : {}),
            ...(state   ? { 'address.state':  state }      : {}),
            ...(pincode ? { 'address.pincode':pincode }    : {}),
            ...(country ? { 'address.country':country }   : {}),
            ...(guid    ? { tallyGuid:   guid }             : {}),
            ...(alterId ? { tallyAlterId:alterId }          : {}),
          },
          $setOnInsert: {
            ledgerCode, ledgerName: name,
            contactPerson, panNumber: 'N/A', isActive: true,
          },
        },
        upsert: true,
      }});

      if (!isCred && !isDebt) continue;

      if (isCred) {
        // Vendor (Sundry Creditor)
        vendorOps.push({ updateOne: {
          filter: guid ? { tallyGuid: guid } : { companyName: name },
          update: {
            $set: {
              tallySynced: true, lastTallySync: new Date(),
              ...(phone          ? { phone }                 : {}),
              ...(email          ? { email: safeEmail }      : {}),
              ...(contactPerson  ? { contactPerson }         : {}),
              ...(addrStr        ? { address: addrStr }      : {}),
              ...(city           ? { city }                  : {}),
              ...(state          ? { state }                 : {}),
              ...(pincode        ? { pincode }               : {}),
              ...(gstNum !== 'N/A' ? { gstNumber: gstNum }  : {}),
              ...(guid    ? { tallyGuid:   guid }             : {}),
              ...(alterId ? { tallyAlterId:alterId }          : {}),
            },
            $setOnInsert: {
              vendorId:      `VND-TALLY-${Date.now() % 1000000}-${vendorOps.length}`,
              companyName:   name,
              category:      'General',
              contactPerson: contactPerson || name,
              phone:         safePhone,
              email:         safeEmail,
              address:       addrStr  || 'Imported from Tally',
              city:          city     || 'Unknown',
              state:         state    || 'Unknown',
              pincode:       pincode  || '000000',
              status:        'Active',
            },
          },
          upsert: true,
        }});
      } else {
        // Client (Sundry Debtor)
        clientOps.push({ updateOne: {
          filter: guid ? { tallyGuid: guid } : { name },
          update: {
            $set: {
              tallySynced: true, lastTallySync: new Date(),
              ...(phone          ? { phone }                 : {}),
              ...(email          ? { email: safeEmail }      : {}),
              ...(contactPerson  ? { contact: contactPerson }: {}),
              ...(addrStr        ? { address: addrStr }      : {}),
              ...(city           ? { city }                  : {}),
              ...(gstNum !== 'N/A' ? { gstNumber: gstNum }  : {}),
              ...(guid    ? { tallyGuid:   guid }             : {}),
              ...(alterId ? { tallyAlterId:alterId }          : {}),
            },
            $setOnInsert: {
              clientId:  `CLT-TALLY-${Date.now() % 1000000}-${clientOps.length}`,
              name,
              contact:   contactPerson || name,
              phone:     safePhone,
              email:     safeEmail,
              city:      city || 'Unknown',
              category:  'Trading',
              status:    'Active',
            },
          },
          upsert: true,
        }});
      }
    }

    // Write batch to DB
    const results = await Promise.all([
      ledgerOps.length
        ? AccountsLedger.bulkWrite(ledgerOps, { ordered: false })
            .catch(e => { console.error('\n  Ledger err:', e.message); return null; })
        : null,
      vendorOps.length
        ? Vendor.bulkWrite(vendorOps, { ordered: false })
            .catch(e => { console.error('\n  Vendor err:', e.message); return null; })
        : null,
      clientOps.length
        ? Client.bulkWrite(clientOps, { ordered: false })
            .catch(e => { console.error('\n  Client err:', e.message); return null; })
        : null,
    ]);

    lInserted += results[0] ? (results[0].upsertedCount || 0) + (results[0].modifiedCount || 0) : 0;
    vInserted += results[1] ? (results[1].upsertedCount || 0) + (results[1].modifiedCount || 0) : 0;
    cInserted += results[2] ? (results[2].upsertedCount || 0) + (results[2].modifiedCount || 0) : 0;

    const batchNum = Math.floor(i / BATCH) + 1;
    const total    = Math.ceil(matches.length / BATCH);
    process.stdout.write(
      `\r  Batch ${batchNum}/${total} → Ledgers: ${lInserted}  Vendors: ${vInserted}  Clients: ${cInserted}   `
    );
    await new Promise(r => setTimeout(r, 30)); // yield to event loop
  }

  console.log('\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ DONE`);
  console.log(`   Ledgers imported : ${lInserted}`);
  console.log(`   Vendors imported : ${vInserted}`);
  console.log(`   Clients imported : ${cInserted}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  process.exit(0);
}

main().catch(e => {
  console.error('\n❌ Fatal error:', e.message);
  process.exit(1);
});
