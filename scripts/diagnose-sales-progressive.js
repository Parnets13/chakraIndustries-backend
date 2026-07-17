
import mongoose from 'mongoose';
import fs        from 'fs';
import path      from 'path';

import connectDB   from '../config/database.js';
import Invoice     from '../models/Invoice.js';
import ItemMaster  from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';

// ── Logger: write to file AND stdout simultaneously ───────────────────────────
const logLines = [];
const logFile  = path.join(
  process.cwd(), 'logs',
  `sales-progressive-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
);
if (!fs.existsSync(path.join(process.cwd(), 'logs'))) {
  fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
}
function log(...args) {
  const line = args.join(' ');
  console.log(line);
  logLines.push(line);
  fs.appendFileSync(logFile, line + '\n', 'utf8');
}
function logSection(title) {
  const bar = '─'.repeat(80);
  log('\n' + bar);
  log(`  ${title}`);
  log(bar);
}

// ── XML helpers ───────────────────────────────────────────────────────────────
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function td(d) {
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
}
const UNIT_MAP = {
  kg:'Kg', kgs:'Kg', kilogram:'Kg', liter:'Ltr', litre:'Ltr', ltr:'Ltr',
  meter:'Mtr', metre:'Mtr', mtr:'Mtr', box:'Box', boxes:'Box',
  piece:'Pcs', pieces:'Pcs', pcs:'Pcs', pc:'Pcs',
  nos:'Nos', no:'Nos', number:'Nos', units:'Nos', unit:'Nos',
};
const tallyUnit = u => UNIT_MAP[(u||'').toLowerCase().trim()] || 'Nos';

// ── Parse Tally response counters ─────────────────────────────────────────────
function parseResult(xml) {
  const s = String(xml || '');
  const created    = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]    || '0');
  const altered    = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1]    || '0');
  const exceptions = parseInt(s.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1] || '0');
  const errors     = parseInt(s.match(/<ERRORS>(\d+)<\/ERRORS>/i)?.[1]      || '0');
  const lineErrors = [...s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
  const lastErrors = [...s.matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)].map(m => m[1].trim());
  const exBlocks   = [...s.matchAll(/<EXCEPTION>([\s\S]*?)<\/EXCEPTION>/gi)].map(m => m[1].trim());
  const allDiag    = [...lineErrors, ...lastErrors, ...exBlocks].filter(Boolean);
  return { created, altered, exceptions, errors, allDiag, raw: s };
}

// ── Wrap voucher XML in an Import Vouchers envelope ───────────────────────────
function envelope(coTag, voucherXml) {
  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC>
    <REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>
      ${coTag}
      <SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>
    </STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
${voucherXml}
    </TALLYMESSAGE>
  </REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
}

// ── Line-level diff between two XML strings ───────────────────────────────────
function xmlDiff(labelA, xmlA, labelB, xmlB) {
  const linesA = xmlA.split('\n').map(l => l.trim()).filter(Boolean);
  const linesB = xmlB.split('\n').map(l => l.trim()).filter(Boolean);
  const setA   = new Set(linesA);
  const setB   = new Set(linesB);
  const added   = linesB.filter(l => !setA.has(l));
  const removed = linesA.filter(l => !setB.has(l));
  const result  = [];
  if (removed.length === 0 && added.length === 0) {
    result.push('  (no line-level differences)');
  } else {
    if (removed.length) {
      result.push(`  Lines in [${labelA}] but NOT in [${labelB}]:`);
      removed.forEach(l => result.push(`    - ${l}`));
    }
    if (added.length) {
      result.push(`  Lines in [${labelB}] but NOT in [${labelA}]:`);
      added.forEach(l => result.push(`    + ${l}`));
    }
  }
  return result.join('\n');
}

// ── Extract all unique XML tag names from an XML string ──────────────────────
function extractTagNames(xml) {
  const tags = new Set();
  for (const m of String(xml).matchAll(/<([A-Z][A-Z0-9_.]*)[^/]*?>/g)) {
    tags.add(m[1]);
  }
  return tags;
}

// ── Send one round, log result, return { passed, result, xml } ───────────────
async function sendRound(cfg, coTag, roundNum, label, voucherXml, timeoutMs) {
  const fullXml = envelope(coTag, voucherXml);
  log(`\n[ROUND ${roundNum}] ${label}`);
  log(`  → XML size: ${fullXml.length} bytes`);
  log(`  → First 500 chars: ${fullXml.slice(0, 500)}`);
  log('  Voucher body:');
  voucherXml.split('\n').forEach(l => { if (l.trim()) log('    ' + l); });

  let raw;
  try {
    raw = await postXmlWithRetry(cfg, fullXml, timeoutMs, 1);  // 1 attempt — no retry in diagnostic
  } catch (err) {
    log(`  ❌ ERROR (request did not reach Tally): ${err.message}`);
    log(`  This is a transport/config error, not an XML rejection.`);
    log(`  Check: is Tally running? Is tallyLocalUrl set? Is the connector online?`);
    return { passed: false, result: null, xml: fullXml, voucherXml };
  }

  const result = parseResult(raw);
  const status = result.created > 0 ? '✅ CREATED' : result.altered > 0 ? '✅ ALTERED'
               : result.exceptions > 0 ? `❌ EXCEPTIONS=${result.exceptions}` : '⚠️ SKIPPED/UNKNOWN';
  log(`  Result: ${status}  created=${result.created} altered=${result.altered} exceptions=${result.exceptions} errors=${result.errors}`);
  if (result.allDiag.length) {
    log('  Diagnostics:');
    result.allDiag.forEach(d => log(`    → ${d}`));
  } else if (result.exceptions > 0) {
    log('  ⚠ EXCEPTIONS > 0 but NO diagnostic tags returned by Tally.');
    log('  Full raw response follows:');
    log(raw);
  }

  const passed = result.created > 0 || result.altered > 0;
  return { passed, result, xml: fullXml, voucherXml };
}

// ── Fetch an actual Sales voucher XML from Tally for comparison ───────────────
async function fetchTallySalesVoucher(cfg, company) {
  const co = company.trim().toUpperCase();
  const coTag = co ? `<SVCURRENTCOMPANY>${esc(co)}</SVCURRENTCOMPANY>` : '';
  // Export the 5 most recent Sales vouchers via TDL collection so we can inspect tags
  const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>RecentSalesVouchers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>
    ${coTag}
    <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
  </STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="RecentSalesVouchers">
      <TYPE>Voucher</TYPE>
      <FETCH>
        Date, EffectiveDate, VoucherNumber, VoucherTypeName,
        PartyLedgerName, IsInvoice, BuyersOrderNo, Narration,
        AllLedgerEntries, AllInventoryEntries, BillAllocations,
        AccountingAllocations, GSTLedgerSource, HSNLedgerSource,
        GSTSourceType, HSNSourceType, GSTHsnName,
        GSTOverrideTaxability, GSTOverrideSupplyType,
        BasicBaseBuyerName, BasicBuyerAddress, BasicBuyerState, BasicBuyerGSTIN,
        BasicBuyerMailingName, BasicBuyerAddress
      </FETCH>
      <MAXCOUNT>5</MAXCOUNT>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;
  try {
    const resp = await postXmlWithRetry(cfg, xml, 60000, 1);
    return resp;
  } catch (e) {
    return null;
  }
}

// ── Delete a test voucher from Tally (cleanup) ────────────────────────────────
async function deleteTestVoucher(cfg, coTag, voucherNo, date, timeoutMs) {
  const delXml = envelope(coTag, `<VOUCHER VCHTYPE="Sales" ACTION="Delete">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(voucherNo)}</VOUCHERNUMBER>
</VOUCHER>`);
  try {
    await postXmlWithRetry(cfg, delXml, timeoutMs);
  } catch (_) { /* non-fatal */ }
}

// ────────────────────────────────────────────────────────────────────────────
// MAIN
// ────────────────────────────────────────────────────────────────────────────
await connectDB();
log(`✅ MongoDB connected`);

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) { log('❌ No TallyConfig found'); process.exit(1); }

const company      = (cfg.companyName || '').trim().toUpperCase();
const coTag        = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
const connectorMode = !!(cfg.useConnector && cfg.connectorId);
const hasLocalUrl   = !!(cfg.tallyLocalUrl || '').trim();

// Mirror the exact timeout logic from tallyExportService.postXml:
//   connector mode → scale up to at least 3× or 3 min
//   direct mode    → use a fixed 30 s (same as production export calls)
const BASE_TIMEOUT = 30000;
const TIMEOUT = connectorMode ? Math.max(BASE_TIMEOUT * 3, 180000) : BASE_TIMEOUT;

log(`\nTallyConfig:`);
log(`  companyName   = "${company}"`);
log(`  useConnector  = ${cfg.useConnector}`);
log(`  connectorId   = ${cfg.connectorId || '(none)'}`);
log(`  tallyLocalUrl = ${cfg.tallyLocalUrl || '(none)'}`);
log(`  port          = ${cfg.port || '9000'}`);
log(`  serverUrl     = ${cfg.serverUrl || '(none)'}`);
log(`  effectivePath = ${connectorMode ? 'CONNECTOR → Socket.IO' : hasLocalUrl ? `DIRECT → ${cfg.tallyLocalUrl}` : 'DIRECT → http://localhost:' + (cfg.port || '9000')}`);
log(`  timeout       = ${TIMEOUT}ms`);
log(`  log file      = ${logFile}`);

// ── Guard: warn if the production HTTP path will throw before reaching Tally ──
// tallyFetchEngine.tallyBaseUrl() throws when useConnector=true but connector is
// offline and tallyLocalUrl is empty — that produces an instant "error" that looks
// like a timeout from the outside.  Print the diagnosis now so it is visible.
if (connectorMode && !hasLocalUrl) {
  log(`\n⚠  WARNING: useConnector=true and tallyLocalUrl is empty.`);
  log(`   If the connector is currently offline, every request will throw immediately`);
  log(`   (not a network timeout — tallyFetchEngine rejects the call before sending).`);
  log(`   To test locally without the connector, set tallyLocalUrl=http://localhost:9000`);
  log(`   in TallyConfig (Settings → Tally → Local URL) and re-run this script.`);
  log(`   Continuing anyway — if the connector IS online this will work fine.\n`);
}

// ── Load target invoice ────────────────────────────────────────────────────
const targetNo = process.argv[2] || null;
const invQuery = targetNo
  ? { invoiceNo: targetNo }
  : { status: { $nin: ['Cancelled'] }, source: { $nin: ['Tally', 'tally'] } };

const inv = await Invoice.findOne(invQuery).lean();
if (!inv) {
  log(`❌ No invoice found ${targetNo ? `with invoiceNo="${targetNo}"` : '(no pending ERP invoices)'}`);
  await mongoose.disconnect(); process.exit(1);
}

// Load matching ItemMasters for HSN / GST data
const itemNames  = (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean);
const itemMasters = await ItemMaster.find({ name: { $in: itemNames } }).lean();
const imMap       = new Map(itemMasters.map(im => [im.name, im]));

// ── Compute amounts once (never recomputed per round) ─────────────────────
const grandTotal = +(inv.grandTotal || inv.totalAmount || 0).toFixed(2);
const cgstTotal  = +(inv.cgstTotal  ?? (inv.items||[]).reduce((s,i) => s+(i.cgst||0),  0)).toFixed(2);
const sgstTotal  = +(inv.sgstTotal  ?? (inv.items||[]).reduce((s,i) => s+(i.sgst||0),  0)).toFixed(2);
const igstTotal  = +(inv.igstTotal  ?? (inv.items||[]).reduce((s,i) => s+(i.igst||0),  0)).toFixed(2);
const salesBase  = +(grandTotal - cgstTotal - sgstTotal - igstTotal).toFixed(2);

const today    = td(new Date());
const vDate    = td(inv.invoiceDate) || today;
const rawItems = (inv.items || []).filter(i => (i.description || i.name || '').trim());

// Use a unique debug prefix to avoid collision with real voucher numbers
const RUN_ID = `DIAG-${Date.now().toString().slice(-6)}`;

log(`\nInvoice: ${inv.invoiceNo}`);
log(`  partyName  = "${inv.partyName}"`);
log(`  grandTotal = ${grandTotal}`);
log(`  cgst       = ${cgstTotal}`);
log(`  sgst       = ${sgstTotal}`);
log(`  igst       = ${igstTotal}`);
log(`  salesBase  = ${salesBase}`);
log(`  vDate      = ${vDate}  (original invoice date)`);
log(`  today      = ${today}  (used as voucher date in rounds)`);
log(`  itemCount  = ${rawItems.length}`);
rawItems.forEach((it, i) => {
  const im = imMap.get((it.description || it.name || '').trim());
  log(`  item[${i}]: name="${it.description||it.name}" qty=${it.qty||1} rate=${it.rate||0} amt=${it.amount||0} unit=${it.unit||''} hsn=${im?.hsn||''} gst=${im?.gst||0}`);
});

// balance check
const creditCheck = +(cgstTotal + sgstTotal + igstTotal + salesBase).toFixed(2);
if (Math.abs(grandTotal - creditCheck) > 0.01) {
  log(`\n⚠ BALANCE MISMATCH: debit=${grandTotal} sum(credits)=${creditCheck} diff=${+(grandTotal - creditCheck).toFixed(4)}`);
  log('  The voucher will fail in Tally regardless of other tags.');
  log('  Fix the invoice amounts in the ERP before debugging further.\n');
}

// ── Fetch actual GST ledger names from Tally ──────────────────────────────
logSection('PRE-FLIGHT: Fetch actual Tally ledger names');

// Using <SYSTEM:FORMULA> with $Parent filter crashes Tally Prime EDU with
// "TDL Error! Description not found (System Formulae - 'IsDuties')".
// Fetch all ledgers and filter client-side — works across all Tally editions.
const dutiesXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>AllLedgers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="AllLedgers">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, TaxType</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

let cgstLed = 'CGST', sgstLed = 'SGST', igstLed = 'IGST';
try {
  const dr = await postXmlWithRetry(cfg, dutiesXml, TIMEOUT, 1);
  const cNames = [], sNames = [], iNames = [];
  for (const m of dr.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
    const blk    = m[1];
    const name   = (blk.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
    const parent = (blk.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim().toLowerCase();
    const tt     = (blk.match(/<TAXTYPE>(.*?)<\/TAXTYPE>/i)?.[1] || '').trim().toLowerCase();
    if (!name) continue;
    const nl = name.toLowerCase();
    // Include if: parent is Duties & Taxes, OR TaxType is set, OR name contains gst keyword.
    // This avoids false positives (non-GST ledgers named something else) while being
    // resilient to Tally not returning the Parent tag in all collection responses.
    const isDutiesParent = parent.includes('duties') || parent.includes('tax');
    const hasTaxType = !!tt;
    const hasGstName = nl.includes('cgst') || nl.includes('sgst') || nl.includes('igst');
    if (!isDutiesParent && !hasTaxType && !hasGstName) continue;
    if (tt === 'central tax'    || nl.includes('cgst')) cNames.push(name);
    if (tt === 'state tax'      || nl.includes('sgst')) sNames.push(name);
    if (tt === 'integrated tax' || nl.includes('igst')) iNames.push(name);
  }
  
  // ── CRITICAL FIX: For Sales vouchers, prefer Output/plain ledgers (not Input) ──
  // Tally returns ledgers in arbitrary order. "Input CGST 0%" comes before "CGST"
  // alphabetically → using [0] blindly gives us a purchase ledger, which causes
  // the cryptic "Voucher date is missing" error when used in a Sales voucher.
  //
  // Selection priority for Sales vouchers:
  //   1. Output ledger matching the computed rate (e.g. "Output CGST @ 2.5%")
  //   2. Plain ledger (exact match: "CGST", "SGST", "IGST")
  //   3. Any Output ledger (no rate restriction)
  //   4. Any ledger NOT starting with "Input"
  //   5. First available ledger (fallback)
  const pickSalesLedger = (names, defaultName, ratePercent = 0) => {
    if (!names || names.length === 0) return defaultName;
    // Build rate tokens for matching: e.g. 2.5 → ["2.5", "2", "3"]
    const rateFixed   = ratePercent ? ratePercent.toFixed(1) : '0';
    const rateFloor   = ratePercent ? String(Math.floor(ratePercent)) : '0';
    const rateRounded = ratePercent ? String(Math.round(ratePercent)) : '0';
    const tokens = [...new Set([rateFixed, rateFloor, rateRounded])];
    // Priority 1: Output ledger with matching rate
    for (const token of tokens) {
      const m = names.find(n => {
        const low = n.toLowerCase();
        return low.startsWith('output') && (low.includes(token + '%') || low.includes('@ ' + token));
      });
      if (m) return m;
    }
    // Priority 2: exact plain ledger (e.g. "CGST")
    const plain = names.find(n => n === defaultName);
    if (plain) return plain;
    // Priority 3: any Output ledger
    const anyOutput = names.find(n => n.toLowerCase().startsWith('output'));
    if (anyOutput) return anyOutput;
    // Priority 4: any non-Input ledger
    const nonInput = names.find(n => !n.toLowerCase().startsWith('input'));
    if (nonInput) return nonInput;
    return names[0];
  };

  // Compute the effective GST rates from the invoice amounts
  const cgstRate = cgstTotal && salesBase ? +((cgstTotal / salesBase) * 100).toFixed(2) : 0;
  const sgstRate = sgstTotal && salesBase ? +((sgstTotal / salesBase) * 100).toFixed(2) : 0;
  const igstRate = igstTotal && salesBase ? +((igstTotal / salesBase) * 100).toFixed(2) : 0;

  cgstLed = pickSalesLedger(cNames, 'CGST', cgstRate);
  sgstLed = pickSalesLedger(sNames, 'SGST', sgstRate);
  igstLed = pickSalesLedger(iNames, 'IGST', igstRate);
  
  log(`  CGST ledgers in Tally : [${cNames.join(', ')}]  → using "${cgstLed}"`);
  log(`  SGST ledgers in Tally : [${sNames.join(', ')}]  → using "${sgstLed}"`);
  log(`  IGST ledgers in Tally : [${iNames.join(', ')}]  → using "${igstLed}"`);
} catch (e) {
  log(`  ⚠ Could not fetch Duties ledgers: ${e.message}  (using fallback names)`);
}

// ── Auto-create required masters before any voucher round ─────────────────
logSection('PRE-FLIGHT: Ensure masters exist in Tally');
const stockCreateXml = rawItems.map(it => {
  const n    = (it.description || it.name || '').trim();
  const unit = tallyUnit(it.unit || 'Nos');
  return `<STOCKITEM NAME="${esc(n)}" ACTION="Create"><NAME>${esc(n)}</NAME><UNITS>${unit}</UNITS></STOCKITEM>`;
}).join('');
const mastersXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
    <LEDGER NAME="${esc(inv.partyName)}" ACTION="Create">
      <NAME>${esc(inv.partyName)}</NAME><PARENT>Sundry Debtors</PARENT>
      <ISBILLWISEON>Yes</ISBILLWISEON>
    </LEDGER>
    <LEDGER NAME="${esc(cgstLed)}" ACTION="Create">
      <NAME>${esc(cgstLed)}</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE>
    </LEDGER>
    <LEDGER NAME="${esc(sgstLed)}" ACTION="Create">
      <NAME>${esc(sgstLed)}</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE>
    </LEDGER>
    <LEDGER NAME="${esc(igstLed)}" ACTION="Create">
      <NAME>${esc(igstLed)}</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE>
    </LEDGER>
    <LEDGER NAME="Sales Accounts" ACTION="Create">
      <NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT>
    </LEDGER>
    ${stockCreateXml}
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
log(`  → Masters XML size: ${mastersXml.length} bytes`);
log(`  → Sending masters pre-create request...`);
try {
  const mr = await postXmlWithRetry(cfg, mastersXml, TIMEOUT, 1);
  const mc = parseResult(mr);
  log(`  ✅ Masters: created=${mc.created} altered=${mc.altered} exceptions=${mc.exceptions}`);
} catch (e) { log(`  ⚠ Masters pre-create failed: ${e.message}`); }

// ────────────────────────────────────────────────────────────────────────────
// PROGRESSIVE ROUNDS — each adds exactly one XML layer
// ────────────────────────────────────────────────────────────────────────────
logSection('PROGRESSIVE ROUNDS');

// Shared building blocks (never changes across rounds)
const partyEntry = `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>`;

const cgstEntry = cgstTotal > 0 ? `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLed)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${cgstTotal.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : '';

const sgstEntry = sgstTotal > 0 ? `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLed)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${sgstTotal.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : '';

const igstEntry = igstTotal > 0 ? `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(igstLed)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${igstTotal.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : '';

const salesEntry = `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${salesBase.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>`;

// Inventory lines (used from round 2 onwards)
const inventoryEntries = rawItems.map(it => {
  const nm   = (it.description || it.name || '').trim();
  const qty  = +(it.qty || it.quantity || 1);
  const rate = +(it.rate || it.unitPrice || 0);
  const amt  = +(it.amount || it.basic || (qty * rate)).toFixed(2);
  const unit = tallyUnit(it.unit || 'Nos');
  const im   = imMap.get(nm);
  const hsn  = im?.hsn || '';
  const gstR = im?.gst || 0;
  return { nm, qty, rate, amt, unit, hsn, gstR };
});

// ── Build all 8 rounds ────────────────────────────────────────────────────
// Each round is cumulative: it includes everything from the previous round
// plus exactly one new element.

function makeVoucher(roundNo, voucherNo, extras) {
  const {
    objview = false,
    billAlloc = false,
    withInventory = false,
    gstLedgerSource = false,
    hsnTags = false,
    narration = false,
    gstSourceType = false,
    shipTo = false,
  } = extras;

  const invLines = withInventory ? inventoryEntries.map(it => {
    const acctAlloc = `
      <ACCOUNTINGALLOCATIONS.LIST>
        <LEDGERNAME>Sales Accounts</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
        <AMOUNT>${it.amt.toFixed(2)}</AMOUNT>
      </ACCOUNTINGALLOCATIONS.LIST>`;
    const gstSrcTag = gstLedgerSource ? `
      <GSTSOURCETYPE>${gstSourceType ? 'Ledger' : ''}</GSTSOURCETYPE>
      <GSTLEDGERSOURCE>Sales Accounts</GSTLEDGERSOURCE>
      <HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
      <HSNLEDGERSOURCE>Sales Accounts</HSNLEDGERSOURCE>` : '';
    const ovrdTags = gstLedgerSource ? `
      <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
      <GSTOVRDNTYPEOFSUPPLY>Goods</GSTOVRDNTYPEOFSUPPLY>` : '';
    const hsnTag = (hsnTags && it.hsn) ? `<GSTHSNNAME>${esc(it.hsn)}</GSTHSNNAME>` : '';
    return `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(it.nm)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>${it.rate.toFixed(2)}/${it.unit}</RATE>
    <AMOUNT>${it.amt.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${it.qty} ${it.unit}</ACTUALQTY>
    <BILLEDQTY>${it.qty} ${it.unit}</BILLEDQTY>
    ${gstSrcTag}${ovrdTags}${hsnTag}${acctAlloc}
  </ALLINVENTORYENTRIES.LIST>`;
  }).join('') : '';

  const billAllocXml = billAlloc ? `
      <BILLALLOCATIONS.LIST>
        <NAME>${esc(inv.invoiceNo)}</NAME>
        <BILLTYPE>New Ref</BILLTYPE>
        <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
        <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
      </BILLALLOCATIONS.LIST>` : '';

  // Inject BILLALLOCATIONS into the party entry when round includes it
  const partyEntryWithBill = billAlloc ? `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>${billAllocXml}
  </LEDGERENTRIES.LIST>` : partyEntry;

  const narrationXml = narration
    ? `<NARRATION>ERP Inv: ${esc(inv.invoiceNo)}</NARRATION>` : '';

  const buyersOrderNo = `<BUYERSORDERNO>${esc(inv.buyersOrderNo || inv.purchaseOrderRef || '')}</BUYERSORDERNO>`;

  const shipToXml = shipTo ? `
  <BASICBASEPARTYDETAILS.LIST>
    <BASICBUYERNAME>${esc(inv.partyName)}</BASICBUYERNAME>
    <BASICBUYERADDRESS.LIST>
      <BASICBUYERADDRESS>${esc(inv.partyAddress || '')}</BASICBUYERADDRESS>
    </BASICBUYERADDRESS.LIST>
  </BASICBASEPARTYDETAILS.LIST>` : '';

  const objAttr = objview ? ' OBJVIEW="Invoice Voucher View"' : '';

  // When inventory is present, suppress the top-level Sales Accounts entry
  const salesLedgerLine = withInventory ? '' : salesEntry;

  return `<VOUCHER VCHTYPE="Sales" ACTION="Create"${objAttr}>
  <DATE>${today}</DATE>
  <EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(voucherNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  ${buyersOrderNo}
  ${narrationXml}
  ${partyEntryWithBill}
  ${cgstEntry}${sgstEntry}${igstEntry}
  ${salesLedgerLine}
  ${invLines}
  ${shipToXml}
</VOUCHER>`;
}

// ── Define the 8 progressive rounds ─────────────────────────────────────────
const rounds = [
  {
    label: 'ROUND 1 — Minimal: party debit + GST credits + Sales Accounts (no inventory, no bill-alloc)',
    extras: {},
  },
  {
    label: 'ROUND 2 — Add inventory lines (ALLINVENTORYENTRIES.LIST)',
    extras: { withInventory: true },
  },
  {
    label: 'ROUND 3 — Add GSTSOURCETYPE / GSTLEDGERSOURCE / HSNSOURCETYPE / HSNLEDGERSOURCE on inventory',
    extras: { withInventory: true, gstLedgerSource: true },
  },
  {
    label: 'ROUND 4 — Add GSTOVRDNTAXABILITY + GSTOVRDNTYPEOFSUPPLY (GST override tags)',
    extras: { withInventory: true, gstLedgerSource: true },  // already included in gstLedgerSource block
  },
  {
    label: 'ROUND 5 — Add GSTHSNNAME tags on inventory lines',
    extras: { withInventory: true, gstLedgerSource: true, hsnTags: true },
  },
  {
    label: 'ROUND 6 — Add BILLALLOCATIONS.LIST inside party ledger entry',
    extras: { withInventory: true, gstLedgerSource: true, hsnTags: true, billAlloc: true },
  },
  {
    label: 'ROUND 7 — Add NARRATION tag',
    extras: { withInventory: true, gstLedgerSource: true, hsnTags: true, billAlloc: true, narration: true },
  },
  {
    label: 'ROUND 8 — Add OBJVIEW + BASICBASEPARTYDETAILS.LIST (ship-to block)',
    extras: { withInventory: true, gstLedgerSource: true, hsnTags: true, billAlloc: true, narration: true, objview: true, shipTo: true },
  },
];

// ── Execute rounds until first failure ───────────────────────────────────────
let lastPassingXml    = null;
let lastPassingVoucher = null;
let lastPassingRound   = 0;
let failingRound       = null;
let failingXml         = null;
let failingVoucher     = null;
const createdVoucherNos = [];   // track all successfully created debug vouchers for cleanup

for (let i = 0; i < rounds.length; i++) {
  const rnd     = rounds[i];
  const rNo     = i + 1;
  const vNo     = `${RUN_ID}-R${rNo}`;
  const voucher = makeVoucher(rNo, vNo, rnd.extras);
  const r       = await sendRound(cfg, coTag, rNo, rnd.label, voucher, TIMEOUT);

  if (r.passed) {
    lastPassingXml     = r.xml;
    lastPassingVoucher = voucher;
    lastPassingRound   = rNo;
    createdVoucherNos.push(vNo);
    // Continue to next round
  } else {
    failingRound   = rNo;
    failingXml     = r.xml;
    failingVoucher = voucher;
    log(`\n⛔ STOPPED at ROUND ${rNo} — this is the FIRST round that produces EXCEPTIONS=1`);
    break;
  }
}

// ── Report diff between last passing and first failing round ─────────────────
logSection('DIFF: last passing round vs first failing round');

if (failingRound === null) {
  log('\n✅ ALL 8 ROUNDS PASSED — the Sales voucher XML is accepted by Tally in every configuration tested.');
  log('   If the main export is still failing, the issue is NOT in the XML structure.');
  log('   Most likely causes:');
  log('   1. The real invoice has a balance mismatch (check amounts in the ERP)');
  log('   2. The SVCURRENTCOMPANY tag is wrong or the company is closed');
  log('   3. A specific stock item or ledger name in the real invoice is missing in Tally');
  log('   Run: node scripts/debug-sales-exceptions.js <invoiceNo>  for a targeted check');
} else if (failingRound === 1) {
  log('\n❌ ROUND 1 (minimal voucher) already fails — this means the basic structure is rejected.');
  log('   Most likely causes:');
  log('   1. Party ledger "' + inv.partyName + '" does not exist in Tally (check Sundry Debtors)');
  log('   2. GST ledger names "' + cgstLed + '" / "' + sgstLed + '" do not exist in Tally');
  log('   3. "Sales Accounts" ledger does not exist in Tally');
  log('   4. SVCURRENTCOMPANY is wrong — Tally is rejecting the company tag');
  log('   5. Voucher date ' + today + ' is outside the Tally company period');
  log('\n  Full failing XML:');
  log(failingVoucher || '(not available)');
} else {
  log(`\n  Last PASSING round : ${lastPassingRound} — "${rounds[lastPassingRound - 1].label}"`);
  log(`  First FAILING round: ${failingRound}     — "${rounds[failingRound  - 1].label}"`);
  log(`\n  What changed (the EXACT XML difference that triggered EXCEPTIONS=1):`);
  const diff = xmlDiff(
    `Round ${lastPassingRound}`, lastPassingVoucher || '',
    `Round ${failingRound}`,     failingVoucher     || ''
  );
  log(diff);
  log(`\n  CONCLUSION: The XML element(s) shown above as "+" are what caused the failure.`);
  log(`  Do NOT touch other elements — only investigate those tagged lines.`);
}

// ── Fetch a real Tally Sales voucher and compare tags ─────────────────────────
logSection('TAG COMPARISON: ERP XML vs actual Tally Sales voucher');

log('\nFetching actual Sales voucher(s) from Tally via TDL export...');
const tallyVoucherResp = await fetchTallySalesVoucher(cfg, company);

if (!tallyVoucherResp || tallyVoucherResp.length < 50) {
  log('  ⚠ No Sales vouchers found in Tally (or response empty).');
  log('    Possible reasons:');
  log('    • No Sales vouchers exist in this Tally company yet');
  log('    • Company period is empty');
  log('    • TDL collection syntax is not supported on this Tally version');
  log('  Cannot perform tag comparison without a reference voucher.');
} else {
  log(`  Raw Tally voucher export length: ${tallyVoucherResp.length} chars`);

  // Extract the first VOUCHER block from the TDL response
  const voucherMatch = tallyVoucherResp.match(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/i);
  const tallyVoucherBlock = voucherMatch ? voucherMatch[0] : tallyVoucherResp;

  log('\n  Raw Tally voucher XML (first match):');
  log(tallyVoucherBlock);

  // Tag comparison
  const erpTags   = extractTagNames(failingVoucher || lastPassingVoucher || '');
  const tallyTags = extractTagNames(tallyVoucherBlock);

  const missingInERP   = [...tallyTags].filter(t => !erpTags.has(t));
  const extraInERP     = [...erpTags].filter(t => !tallyTags.has(t));

  log('\n  MISSING from ERP XML (present in Tally export but absent from what we send):');
  if (missingInERP.length === 0) {
    log('    (none — ERP XML contains all tags that appear in the Tally export)');
  } else {
    missingInERP.forEach(t => log(`    MISSING: <${t}>`));
  }

  log('\n  EXTRA in ERP XML (present in what we send but absent from Tally export):');
  if (extraInERP.length === 0) {
    log('    (none — ERP XML has no tags that are absent from the Tally export)');
  } else {
    extraInERP.forEach(t => log(`    EXTRA:   <${t}>`));
  }

  // Also diff the attribute of the VOUCHER opening tag itself
  const tallyVAttr = (tallyVoucherResp.match(/<VOUCHER([^>]*)>/i)?.[1] || '').trim();
  const erpVAttr   = (failingVoucher || lastPassingVoucher || '').match(/<VOUCHER([^>]*)>/i)?.[1]?.trim() || '';
  log(`\n  Tally VOUCHER tag attributes  : <VOUCHER ${tallyVAttr}>`);
  log(`  ERP   VOUCHER tag attributes  : <VOUCHER ${erpVAttr}>`);
  if (tallyVAttr !== erpVAttr) {
    log('  ⚠ ATTRIBUTE MISMATCH — differences above may cause rejection');
  } else {
    log('  ✅ Attributes match');
  }
}

// ── Cleanup: delete all test vouchers created in this run ─────────────────────
logSection('CLEANUP: deleting test vouchers from Tally');

if (createdVoucherNos.length === 0) {
  log('  No vouchers to clean up (none were created, or all rounds failed).');
} else {
  log(`  Deleting ${createdVoucherNos.length} test voucher(s): ${createdVoucherNos.join(', ')}`);
  for (const vno of createdVoucherNos) {
    await deleteTestVoucher(cfg, coTag, vno, today, TIMEOUT);
    log(`  Deleted: ${vno}`);
  }
}

// ── Final summary ─────────────────────────────────────────────────────────────
logSection('SUMMARY');

if (failingRound === null) {
  log('  RESULT: All 8 rounds passed. Sales voucher XML structure is valid.');
  log('  ACTION: The issue lies outside XML structure — check amounts, company name, or date.');
} else {
  log(`  RESULT: Failed at ROUND ${failingRound}`);
  log(`  FAILING ELEMENT DESCRIPTION: ${rounds[failingRound - 1].label}`);
  log('');
  log('  Next steps:');
  log(`  1. Look at the diff above — the "+" lines are the exact XML that caused EXCEPTIONS=1`);
  log(`  2. DO NOT change existing export logic yet`);
  log(`  3. Investigate WHY Tally rejects that specific element (wrong value, wrong ledger name, wrong structure)`);
  log(`  4. Once the cause is identified, bring it here for a targeted fix`);
}

log(`\n  Full diagnostic log saved to: ${logFile}`);

await mongoose.disconnect();
process.exit(0);
