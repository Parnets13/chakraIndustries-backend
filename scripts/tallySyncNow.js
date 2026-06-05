
import dotenv from 'dotenv';
import axios  from 'axios';
import connectDB      from '../config/database.js';
import TallyConfig    from '../models/TallyConfig.js';
import ItemMaster     from '../models/ItemMaster.js';
import AccountsLedger from '../models/AccountsLedger.js';
import Vendor         from '../models/Vendor.js';
import Client         from '../models/Client.js';
import TallyVoucher   from '../models/TallyVoucher.js';
import Invoice        from '../models/Invoice.js';

dotenv.config();

// ── URL config ────────────────────────────────────────────────────────────────
const TALLY_URL_ENV  = (process.env.TALLY_LOCAL_URL || '').trim();
const TALLY_PORT_ENV = (process.env.TALLY_PORT || '9000').trim();
const COMPANY        = process.env.TALLY_COMPANY || 'SRI CHAKRA INDUSTRIES';
const TIMEOUT_MS     = 90_000;   // 90 s per request
const ITEM_DELAY_MS  = 150;      // pause between individual item fetches
const BATCH_SAVE     = 50;       // upsert to DB every N items

function buildTallyUrl(localUrl, port) {
  if (!localUrl) return `http://localhost:${port}`;
  if (localUrl.startsWith('https://')) return localUrl.replace(/\/$/, '');
  if (localUrl.match(/:\d+$/)) return localUrl.replace(/\/$/, '');
  return `${localUrl.replace(/\/$/, '')}:${port}`;
}
const TALLY_URL = buildTallyUrl(TALLY_URL_ENV, TALLY_PORT_ENV);

const fmtDate  = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
const sleep    = ms => new Promise(r => setTimeout(r, ms));

// Decode XML entities (handles single + double encoding)
const decodeXml = s => {
  if (!s) return '';
  let v = String(s);
  for (let i = 0; i < 2; i++) {
    v = v.replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>')
         .replace(/&quot;/gi,'"').replace(/&apos;/gi,"'");
  }
  return v;
};
const esc = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

const gGuid  = b => b.match(/<GUID>(.*?)<\/GUID>/i)?.[1]?.trim()             || null;
const gAlter = b => b.match(/<ALTERID[^>]*>(.*?)<\/ALTERID>/i)?.[1]?.trim()  || null;
const gVal   = (b,t) => b.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i'))?.[1]?.trim() || '';

// ── HTTP POST with 3 retries ──────────────────────────────────────────────────
async function post(xml, label, silent = false) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (!silent) process.stdout.write(`\r   → ${label} (attempt ${attempt}) `);
      const r = await axios({
        method: 'POST', url: TALLY_URL, data: xml,
        headers: { 'Content-Type': 'text/xml', Accept: '*/*' },
        timeout: TIMEOUT_MS, responseType: 'text', validateStatus: () => true,
        maxContentLength: Infinity, maxBodyLength: Infinity,
      });
      const body = typeof r.data === 'string' ? r.data : String(r.data || '');
      if (!silent) process.stdout.write(`← ${r.status} (${body.length} bytes)\n`);
      return body;
    } catch (e) {
      if (!silent) process.stdout.write(`✗ ${e.message}\n`);
      if (attempt < 3) await sleep(3000);
    }
  }
  return '';
}

// ── Save a batch of ops to MongoDB ────────────────────────────────────────────
async function saveBatch(Model, ops, label) {
  if (!ops.length) return 0;
  const r = await Model.bulkWrite(ops, { ordered: false })
    .catch(e => { console.error(`\n   ⚠ ${label} bulkWrite error:`, e.message); return null; });
  return r ? (r.upsertedCount || 0) + (r.modifiedCount || 0) : 0;
}

// ── STEP 1: Test Connection ───────────────────────────────────────────────────
async function step1_testConnection() {
  console.log('\n━━ STEP 1: Test Connection ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`   Tally URL : ${TALLY_URL}`);
  console.log(`   Company   : ${COMPANY}`);

  const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  const resp = await post(xml, 'Connection test');

  if (!resp || resp.length < 5) {
    console.log('   ❌ No response. Is Tally running with HTTP Server on port 9000?');
    process.exit(1);
  }
  console.log(`   ✅ Tally is UP. Response: ${resp.slice(0, 120)}`);
  await TallyConfig.findOneAndUpdate({},
    { $set: { tallyLocalUrl: TALLY_URL, companyName: COMPANY, connectionStatus: 'Connected' }},
    { upsert: true });
}

// ── STEP 2: Stock Items — name list first, then one-by-one ───────────────────
async function step2_stockItems() {
  console.log('\n━━ STEP 2: Stock Items (sequential) ━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // 2a. Get all stock item names in one lightweight request
  const listXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>List of Stock Items</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${esc(COMPANY)}</SVCURRENTCOMPANY>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  const listResp = await post(listXml, 'Stock item names');
  if (!listResp || !listResp.includes('<STOCKITEM')) {
    // Fall back to Stock Summary name extraction
    console.log('   Trying Stock Summary fallback...');
    const sumXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Stock Summary</REPORTNAME><STATICVARIABLES><SVCURRENTCOMPANY>${esc(COMPANY)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const sumResp = await post(sumXml, 'Stock Summary');
    const nameMatches = [...(sumResp||'').matchAll(/<DSPDISPNAME>([\s\S]*?)<\/DSPDISPNAME>/gi)];
    if (!nameMatches.length) { console.log('   ✗ No stock items found'); return 0; }

    const seen = new Set();
    const names = nameMatches.map(m => m[1]?.trim()).filter(n => n && n !== 'Name' && !seen.has(n) && seen.add(n));
    console.log(`   Found ${names.length} stock item names via Stock Summary`);
    return await fetchStockItemsOneByOne(names);
  }

  // Parse names from List of Stock Items
  const nameMatches = [...listResp.matchAll(/<STOCKITEM[^>]+NAME="([^"]+)"/gi)];
  const seen = new Set();
  const names = nameMatches.map(m => m[1]?.trim()).filter(n => n && !seen.has(n) && seen.add(n));
  console.log(`   Found ${names.length} stock item names`);
  if (!names.length) { console.log('   ✗ No items found'); return 0; }

  return await fetchStockItemsOneByOne(names);
}

async function fetchStockItemsOneByOne(names) {
  let saved = 0, ops = [], idx = 0;

  for (const name of names) {
    idx++;
    // Fetch individual stock item detail
    const xml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Stock Item</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${esc(COMPANY)}</SVCURRENTCOMPANY>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <STOCKITEMNAME>${esc(name)}</STOCKITEMNAME>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

    const resp = await post(xml, `[${idx}/${names.length}] Item: ${name.slice(0,30)}`, true);
    process.stdout.write(`\r   [${idx}/${names.length}] ${name.slice(0,40).padEnd(40)} saved:${saved}   `);

    let guid = null, alterId = null, hsn = '', gstRate = 0, unit = 'units', cost = 0;

    if (resp && resp.includes('<STOCKITEM')) {
      const m = resp.match(/<STOCKITEM[^>]*>([\s\S]*?)<\/STOCKITEM>/i);
      if (m) {
        const block = m[1];
        guid     = gGuid(block);
        alterId  = gAlter(block);
        hsn      = gVal(block, 'HSNCODE');
        gstRate  = parseFloat(gVal(block, 'GSTRATE')) || 0;
        const rawUnit = gVal(block, 'BASEUNITS') || 'Nos';
        const uMap = { Nos:'units', Kg:'kg', Ltr:'liter', Mtr:'meter', Box:'box', Pcs:'piece' };
        unit = uMap[rawUnit] || 'units';
        cost = parseFloat(gVal(block, 'STANDARDCOST')) || 0;
      }
    }

    const sku      = name.replace(/[^A-Z0-9]/gi, '-').toUpperCase().slice(0, 30);
    const barcode  = guid
      ? `TALLY-${guid.replace(/[^A-Z0-9]/gi,'').slice(0,20)}`
      : `TALLY-${sku}-${idx}`;

    ops.push({ updateOne: {
      filter: guid ? { tallyGuid: guid } : { name },
      update: {
        $set: {
          hsn, gst: gstRate, unit, costPrice: cost, unitPrice: cost,
          tallySynced: true, lastTallySync: new Date(),
          status: 'Active', isActive: true,
          ...(guid    ? { tallyGuid: guid }      : {}),
          ...(alterId ? { tallyAlterId: alterId } : {}),
        },
        $setOnInsert: {
          itemId:  `TALLY-${sku}-${idx}`,
          sku:     `${sku}-${idx}`,
          name, sellingPrice: cost, barcode,
        },
      },
      upsert: true,
    }});

    // Flush every BATCH_SAVE items
    if (ops.length >= BATCH_SAVE) {
      saved += await saveBatch(ItemMaster, ops, 'ItemMaster');
      ops = [];
    }
    await sleep(ITEM_DELAY_MS);
  }

  // Flush remainder
  if (ops.length) saved += await saveBatch(ItemMaster, ops, 'ItemMaster');

  console.log(`\n   ✅ Stock Items saved: ${saved}`);
  return saved;
}

// ── STEP 3: Ledgers — name list first, then one-by-one ───────────────────────
async function step3_ledgers() {
  console.log('\n━━ STEP 3: Ledgers + Vendors + Clients (sequential) ━━━━━━━━━━━');

  // 3a. Get all ledger names
  const listXml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>List of Ledgers</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${esc(COMPANY)}</SVCURRENTCOMPANY>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

  const listResp = await post(listXml, 'Ledger names');
  if (!listResp) { console.log('   ✗ No response for ledger names'); return; }

  // Extract names from LEDGER NAME="..." attributes or LEDGER tags
  const nameMatches = [...listResp.matchAll(/<LEDGER[^>]+NAME="([^"]+)"/gi)];
  const seen = new Set();
  const names = nameMatches.map(m => decodeXml(m[1]?.trim())).filter(n => n && !seen.has(n) && seen.add(n));

  if (!names.length) {
    // If no NAME= attributes, try extracting from tag content
    const altMatches = [...listResp.matchAll(/<NAME[^>]*>([\s\S]*?)<\/NAME>/gi)];
    altMatches.forEach(m => { const n = decodeXml(m[1]?.trim()); if (n && !seen.has(n)) { seen.add(n); names.push(n); }});
  }

  console.log(`   Found ${names.length} ledger names`);
  if (!names.length) { console.log('   ✗ No ledgers found'); return; }

  let lTotal = 0, vTotal = 0, cTotal = 0;
  let ledgerOps = [], vendorOps = [], clientOps = [];
  let idx = 0;

  for (const name of names) {
    idx++;

    // Fetch individual ledger detail
    const xml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Ledger</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${esc(COMPANY)}</SVCURRENTCOMPANY>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <LEDGERNAME>${esc(name)}</LEDGERNAME>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

    const resp = await post(xml, `[${idx}/${names.length}] Ledger: ${name.slice(0,30)}`, true);
    process.stdout.write(`\r   [${idx}/${names.length}] ${name.slice(0,35).padEnd(35)} L:${lTotal} V:${vTotal} C:${cTotal}   `);

    let block = '';
    if (resp && resp.includes('<LEDGER')) {
      const m = resp.match(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/i);
      if (m) block = m[1];
    }

    const guid    = block ? gGuid(block)  : null;
    const alterId = block ? gAlter(block) : null;
    const parent  = block ? decodeXml(gVal(block, 'PARENT'))       : '';
    const gstNum  = block ? decodeXml(gVal(block, 'PARTYGSTIN'))    : '';
    const obBal   = block ? parseFloat(gVal(block, 'OPENINGBALANCE')) || 0 : 0;
    const email   = block ? decodeXml(gVal(block, 'EMAIL'))          : '';
    const phone   = block ? decodeXml(gVal(block, 'LEDGERMOBILE'))   : '';
    const contactPerson = block ? decodeXml(gVal(block, 'MAILINGNAME')) : '';

    // Address parsing
    const addrLines = block
      ? [...block.matchAll(/<ADDRESS>([\s\S]*?)<\/ADDRESS>/gi)].map(a => decodeXml(a[1].trim())).filter(Boolean)
      : [];
    const tallyCity    = block ? decodeXml(gVal(block, 'LEDGERCITY'))  : '';
    const tallyState   = block ? decodeXml(gVal(block, 'STATENAME') || gVal(block, 'LEDGERSTATE')) : '';
    const tallyPincode = block ? (decodeXml(gVal(block, 'PINCODE') || gVal(block, 'LEDGERPINCODE'))).replace(/\D/g,'').slice(0,6) : '';
    let derivedCity = tallyCity, derivedState = tallyState, derivedPincode = tallyPincode;
    if (!derivedCity || !derivedState) {
      for (const line of addrLines) {
        const pm = line.match(/\b(\d{6})\b/);
        if (pm) {
          if (!derivedPincode) derivedPincode = pm[1];
          const parts = line.replace(pm[0],'').replace(/[-,\s]+$/,'').split(/[,\-]/).map(p=>p.trim()).filter(Boolean);
          if (!derivedCity  && parts[0]) derivedCity  = parts[0];
          if (!derivedState && parts[1]) derivedState = parts[1];
          break;
        }
      }
    }
    const tallyAddress = addrLines.slice(0, 2).join(', ');
    const isCred = /creditor|sundry.c/i.test(parent);
    const isDebt = /debtor|sundry.d/i.test(parent);
    const lCode  = `TALLY-${name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,20)}-${idx%10000}`;

    ledgerOps.push({ updateOne: {
      filter: guid ? { tallyGuid: guid } : { ledgerName: name },
      update: {
        $set: {
          openingBalance: obBal, syncedWithTally: true, lastTallySync: new Date(),
          ledgerGroup: isCred ? 'Sundry Creditors' : isDebt ? 'Sundry Debtors' : (parent || 'General'),
          ...(email         ? { email }                          : {}),
          ...(phone         ? { phone }                          : {}),
          ...(gstNum        ? { gstNumber: gstNum }              : {}),
          ...(tallyAddress  ? { 'address.street': tallyAddress } : {}),
          ...(derivedCity   ? { 'address.city':  derivedCity  }  : {}),
          ...(derivedState  ? { 'address.state': derivedState }  : {}),
          ...(derivedPincode? { 'address.pincode': derivedPincode } : {}),
          ...(guid    ? { tallyGuid: guid }      : {}),
          ...(alterId ? { tallyAlterId: alterId } : {}),
        },
        $setOnInsert: { ledgerCode: lCode, ledgerName: name, contactPerson: contactPerson||name, panNumber: 'N/A', isActive: true },
      },
      upsert: true,
    }});

    if (isCred || isDebt) {
      const _d = phone ? String(phone).replace(/\D/g,'') : '';
      const _c = (() => { let d=_d; if(d.length===12&&d.startsWith('91'))d=d.slice(2); if(d.length===11&&d.startsWith('0'))d=d.slice(1); return d.length===10?d:''; })();
      const sp = _c || _d.slice(0,15) || '0000000000';
      const se = email || `${name.replace(/\s+/g,'').toLowerCase().slice(0,30)}@tally.sync`;

      if (isCred) {
        vendorOps.push({ updateOne: {
          filter: guid ? { tallyGuid: guid } : { companyName: name },
          update: {
            $set: {
              tallySynced: true, lastTallySync: new Date(),
              ...(sp !== '0000000000'   ? { phone:         sp }          : {}),
              ...(email                 ? { email:         se }          : {}),
              ...(contactPerson         ? { contactPerson }              : {}),
              ...(tallyAddress          ? { address:       tallyAddress }: {}),
              ...(derivedCity           ? { city:          derivedCity  }: {}),
              ...(derivedState          ? { state:         derivedState }: {}),
              ...(derivedPincode        ? { pincode:       derivedPincode }:{}),
              ...(gstNum                ? { gstNumber:     gstNum }       : {}),
              ...(guid    ? { tallyGuid: guid }      : {}),
              ...(alterId ? { tallyAlterId: alterId } : {}),
            },
            $setOnInsert: {
              vendorId: `VND-TALLY-${idx}`,
              companyName: name, category: 'General', contactPerson: contactPerson||name,
              phone: sp, email: se,
              address: tallyAddress||'Imported from Tally',
              city:    derivedCity  ||'Unknown',
              state:   derivedState ||'Unknown',
              pincode: derivedPincode||'000000', status: 'Active',
            },
          },
          upsert: true,
        }});
      } else {
        clientOps.push({ updateOne: {
          filter: guid ? { tallyGuid: guid } : { name },
          update: {
            $set: {
              tallySynced: true, lastTallySync: new Date(),
              ...(sp !== '0000000000'   ? { phone:     sp }           : {}),
              ...(email                 ? { email:     se }           : {}),
              ...(contactPerson         ? { contact:   contactPerson }: {}),
              ...(tallyAddress          ? { address:   tallyAddress } : {}),
              ...(derivedCity           ? { city:      derivedCity  } : {}),
              ...(gstNum                ? { gstNumber: gstNum }       : {}),
              ...(guid    ? { tallyGuid: guid }      : {}),
              ...(alterId ? { tallyAlterId: alterId } : {}),
            },
            $setOnInsert: {
              clientId: `CLT-TALLY-${idx}`,
              name, contact: contactPerson||name, phone: sp, email: se,
              city: derivedCity||'Unknown', category: 'Trading', status: 'Active',
            },
          },
          upsert: true,
        }});
      }
    }

    // Flush every BATCH_SAVE
    if (ledgerOps.length >= BATCH_SAVE) {
      lTotal += await saveBatch(AccountsLedger, ledgerOps, 'AccountsLedger'); ledgerOps = [];
    }
    if (vendorOps.length >= BATCH_SAVE) {
      vTotal += await saveBatch(Vendor, vendorOps, 'Vendor'); vendorOps = [];
    }
    if (clientOps.length >= BATCH_SAVE) {
      cTotal += await saveBatch(Client, clientOps, 'Client'); clientOps = [];
    }

    await sleep(ITEM_DELAY_MS);
  }

  // Flush remainder
  lTotal += await saveBatch(AccountsLedger, ledgerOps, 'AccountsLedger');
  vTotal += await saveBatch(Vendor, vendorOps, 'Vendor');
  cTotal += await saveBatch(Client, clientOps, 'Client');

  console.log(`\n   ✅ Ledgers: ${lTotal} | Vendors: ${vTotal} | Clients: ${cTotal}`);
}

// ── STEP 4: Vouchers — monthly chunks, one month at a time ───────────────────
async function step4_vouchers() {
  console.log('\n━━ STEP 4: Vouchers (monthly chunks, 2 years) ━━━━━━━━━━━━━━━━━');

  // Build monthly date ranges covering 2 years back
  const chunks = [];
  const today  = new Date();
  let   cursor = new Date();
  cursor.setFullYear(cursor.getFullYear() - 2);
  cursor.setDate(1);

  while (cursor <= today) {
    const from = new Date(cursor);
    const to   = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    if (to > today) to.setTime(today.getTime());
    chunks.push({ from: fmtDate(from), to: fmtDate(to) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  console.log(`   ${chunks.length} months to fetch — one request at a time`);

  let totalSaved = 0;

  for (let ci = 0; ci < chunks.length; ci++) {
    const { from, to } = chunks[ci];

    // Fetch ONE month's Day Book
    const xml = `<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA><REQUESTDESC>
    <REPORTNAME>Day Book</REPORTNAME>
    <STATICVARIABLES>
      <SVCURRENTCOMPANY>${esc(COMPANY)}</SVCURRENTCOMPANY>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVFROMDATE>${from}</SVFROMDATE>
      <SVTODATE>${to}</SVTODATE>
    </STATICVARIABLES>
  </REQUESTDESC></EXPORTDATA></BODY>
</ENVELOPE>`;

    const resp = await post(xml, `[${ci+1}/${chunks.length}] ${from}→${to}`);
    if (!resp || !resp.includes('<VOUCHER')) continue;

    const allV = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    if (!allV.length) continue;

    // Group by voucher type to separate Invoice vs TallyVoucher
    const byType = {};
    for (const m of allV) {
      const block = m[1];
      const vt = gVal(block, 'VOUCHERTYPENAME') || gVal(block, 'VCHTYPE') || 'Other';
      if (!byType[vt]) byType[vt] = [];
      byType[vt].push(block);
    }

    let chunkSaved = 0;

    for (const [vtype, blocks] of Object.entries(byType)) {
      const ops = [];

      for (const block of blocks) {
        const guid    = gGuid(block);
        const alterId = gAlter(block);
        const vNo     = gVal(block, 'VOUCHERNUMBER');
        const party   = gVal(block, 'PARTYLEDGERNAME');
        const rawDate = gVal(block, 'DATE');
        const amount  = Math.abs(parseFloat(gVal(block, 'AMOUNT')) || 0);
        const narrn   = gVal(block, 'NARRATION');
        const vDate   = rawDate.length === 8
          ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`)
          : new Date();

        if (vtype === 'Sales' || vtype === 'Purchase') {
          if (!vNo) continue;
          ops.push({ updateOne: {
            filter: guid ? { tallyGuid: guid } : { invoiceNo: vNo },
            update: {
              $set: {
                ...(guid    ? { tallyGuid: guid }      : {}),
                ...(alterId ? { tallyAlterId: alterId } : {}),
              },
              $setOnInsert: {
                invoiceNo: vNo, partyName: party, invoiceDate: vDate,
                grandTotal: amount, source: 'manual', status: 'Sent',
                invoiceType: 'single', items: [],
              },
            },
            upsert: true,
          }});
        } else {
          const le = [];
          for (const lex of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
            const lb = lex[1];
            const ln = gVal(lb, 'LEDGERNAME');
            if (ln) le.push({ ledgerName: ln, amount: parseFloat(gVal(lb, 'AMOUNT')) || 0, isDeemed: gVal(lb, 'ISDEEMEDPOSITIVE') === 'Yes' });
          }
          const filter = guid ? { tallyGuid: guid } : (vNo ? { voucherNumber: vNo, voucherType: vtype } : null);
          if (!filter) continue;
          ops.push({ updateOne: {
            filter,
            update: {
              $set: {
                amount, narration: narrn, voucherDate: vDate,
                ledgerEntries: le, source: 'Tally', syncedAt: new Date(),
                ...(guid    ? { tallyGuid: guid }      : {}),
                ...(alterId ? { tallyAlterId: alterId } : {}),
              },
              $setOnInsert: {
                voucherType: vtype,
                voucherNumber: vNo || `TALLY-${Date.now()}`,
                partyName: party,
              },
            },
            upsert: true,
          }});
        }
      }

      if (!ops.length) continue;
      const Model = (vtype === 'Sales' || vtype === 'Purchase') ? Invoice : TallyVoucher;
      const r = await Model.bulkWrite(ops, { ordered: false })
        .catch(e => { console.error(`   ${vtype} err:`, e.message); return null; });
      chunkSaved += r ? (r.upsertedCount||0)+(r.modifiedCount||0) : 0;
    }

    if (chunkSaved > 0) {
      totalSaved += chunkSaved;
      console.log(`   ✓ [${ci+1}/${chunks.length}] ${from}→${to} : saved ${chunkSaved} (total: ${totalSaved})`);
    }

    // Wait before next month request
    await sleep(300);
  }

  console.log(`\n   ✅ Total Vouchers saved: ${totalSaved}`);
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log(`  TALLY FULL SYNC (Sequential) — ${COMPANY}`);
  console.log(`  URL  : ${TALLY_URL}`);
  console.log(`  Mode : One request at a time — no data loss`);
  console.log(`  Time : ${new Date().toLocaleString('en-IN')}`);
  console.log('╚═══════════════════════════════════════════════════════╝');

  await connectDB();
  await sleep(2000);

  await step1_testConnection();
  await sleep(500);

  await step2_stockItems();
  await sleep(500);

  await step3_ledgers();
  await sleep(500);

  await step4_vouchers();

  // ── Final counts ─────────────────────────────────────────────────────────
  console.log('\n╔═══════════════════════════════════════════════════════╗');
  console.log('  FINAL MongoDB Counts');
  console.log('╚═══════════════════════════════════════════════════════╝');
  const [items, vendors, clients, ledgers, vouchers, invoices] = await Promise.all([
    ItemMaster.countDocuments(),
    Vendor.countDocuments(),
    Client.countDocuments(),
    AccountsLedger.countDocuments(),
    TallyVoucher.countDocuments(),
    Invoice.countDocuments(),
  ]);
  console.log(`  Stock Items     : ${items}`);
  console.log(`  Vendors         : ${vendors}`);
  console.log(`  Clients         : ${clients}`);
  console.log(`  Account Ledgers : ${ledgers}`);
  console.log(`  Tally Vouchers  : ${vouchers}`);
  console.log(`  Invoices        : ${invoices}`);
  console.log('\n  ✅ Sync complete.\n');
  process.exit(0);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
