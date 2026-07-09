/**
 * tallyService.js — Bi-directional ERP ↔ Tally sync engine
 * Tally XML API endpoint: https://erp.majesticmall.net
 *
 * Features:
 *  • ERP → Tally: Customers, Vendors, Products, Invoices, POs, Payments, Receipts
 *  • Tally → ERP: Ledgers, Stock Items, Sales/Purchase Vouchers, Payment/Receipt Vouchers
 *  • GUID / AlterID tracking to prevent duplicate records
 *  • Manual and scheduled sync support
 */

import TallyConfig    from '../models/TallyConfig.js';
import TallySyncLog   from '../models/TallySyncLog.js';
import TallyVoucher   from '../models/TallyVoucher.js';
import ItemMaster     from '../models/ItemMaster.js';
import Vendor         from '../models/Vendor.js';
import Client         from '../models/Client.js';
import CorporateClient from '../models/CorporateClient.js';
import AccountsLedger from '../models/AccountsLedger.js';
import PurchaseOrder  from '../models/PurchaseOrder.js';
import Invoice        from '../models/Invoice.js';
import {
  testTallyConnection as fetchEngineTestConnection,
  checkTallyReachable,
  postXmlWithRetry,
} from './tallyFetchEngine.js';
import { normalizeToTallyVoucher } from './normalizeToTallyVoucher.js';

const LOG = (...a) => console.log('[Tally]', ...a);
const ERR = (...a) => console.error('[Tally ERROR]', ...a);

// ─── CONFIG ───────────────────────────────────────────────────────────────────

async function getConfig() {
  let cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
  if (!cfg) cfg = await TallyConfig.create({});
  return cfg;
}

// ─── CONNECTOR TIMEOUT SCALING ───────────────────────────────────────────────
// In connector mode, requests travel: Render cloud → HTTP long-poll → connector PC → Tally → back.
// That round-trip can add 30-90s on top of Tally's processing time.
// Always scale up timeouts in connector mode so results that arrive late are not discarded.
function connectorTimeout(cfg, baseMs) {
  return (cfg?.useConnector && cfg?.connectorId)
    ? Math.max(baseMs * 3, 180000)   // at least 3× the base or 3 min, whichever is larger
    : baseMs;
}

// ─── XML HELPERS ──────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}

function tallyDate(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
}

function staticVars(cfg, extra = '') {
  // Tally stores company names as UPPERCASE internally — always send uppercase
  const company = (cfg.companyName || '').trim().toUpperCase();
  const tag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
  // SVSHOWERRORLIST=Yes makes Tally include LINEERROR tags in the response
  // so we can see the exact reason for each EXCEPTION in the logs.
  return `<STATICVARIABLES>${tag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>${extra}</STATICVARIABLES>`;
}

function exportVars(extra = '') {
  return `<STATICVARIABLES>${extra}</STATICVARIABLES>`;
}

const UNIT_MAP = {
  kg:'Kg', kgs:'Kg', kilogram:'Kg', liter:'Ltr', litre:'Ltr', ltr:'Ltr',
  meter:'Mtr', metre:'Mtr', mtr:'Mtr', box:'Box', boxes:'Box',
  piece:'Pcs', pieces:'Pcs', pcs:'Pcs', pc:'Pcs',
  nos:'Nos', no:'Nos', number:'Nos', units:'Nos', unit:'Nos', pack:'Nos', dozen:'Nos',
};
const tallyUnit = (u) => UNIT_MAP[(u||'').toLowerCase().trim()] || 'Nos';

// Extract GUID from Tally XML response (used for duplicate prevention)
function extractGuid(xmlBlock) {
  const m = xmlBlock.match(/<GUID>(.*?)<\/GUID>/i);
  return m ? m[1].trim() : null;
}
function extractAlterId(xmlBlock) {
  const m = xmlBlock.match(/<ALTERID>(.*?)<\/ALTERID>/i) || xmlBlock.match(/<ALTERID\s+[^>]*>(.*?)<\/ALTERID>/i);
  return m ? m[1].trim() : null;
}

// ─── RESPONSE PARSER ─────────────────────────────────────────────────────────

function parseTallyResponse(xml, label = '') {
  if (!xml || !xml.trim()) return { ok: false, error: 'Empty response from Tally' };
  const s = String(xml);

  // Always log the complete raw response first — before any parsing.
  // This is the single source of truth for what Tally actually said.
  LOG(`${label} RAW RESPONSE:\n${s}`);

  const errors = [];

  // ── Exhaustive diagnostic extraction ──────────────────────────────────────
  // Tally may return different diagnostic tags depending on the error type and
  // version. Extract every known tag and log each one explicitly.

  // 1. LINEERROR — per-record errors when SVSHOWERRORLIST=Yes is set
  const lineErrors = [];
  for (const m of s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)) {
    const msg = m[1].trim();
    if (msg) lineErrors.push(msg);
  }
  if (lineErrors.length > 0) {
    ERR(`${label} ── LINEERROR (${lineErrors.length}) ──`);
    lineErrors.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...lineErrors);
  }

  // 2. LASTERROR — Tally's last validation error, set when an exception occurs
  const lastErrors = [];
  for (const m of s.matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)) {
    const msg = m[1].trim();
    if (msg) lastErrors.push(msg);
  }
  if (lastErrors.length > 0) {
    ERR(`${label} ── LASTERROR (${lastErrors.length}) ──`);
    lastErrors.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...lastErrors);
  }

  // 3. STATUS — numeric status code (0 = success in some contexts, non-zero = error)
  const statusVals = [];
  for (const m of s.matchAll(/<STATUS>([\s\S]*?)<\/STATUS>/gi)) {
    const val = m[1].trim();
    if (val && val !== '1') statusVals.push(val); // 1 = ok in import context
  }
  if (statusVals.length > 0) {
    ERR(`${label} ── STATUS values ──`);
    statusVals.forEach((val, i) => ERR(`${label}   [${i+1}] STATUS=${val}`));
  }

  // 4. EXCEPTION blocks — Tally may embed <EXCEPTION> tags for individual records
  const exceptionBlocks = [];
  for (const m of s.matchAll(/<EXCEPTION>([\s\S]*?)<\/EXCEPTION>/gi)) {
    const msg = m[1].trim();
    if (msg) exceptionBlocks.push(msg);
  }
  if (exceptionBlocks.length > 0) {
    ERR(`${label} ── EXCEPTION blocks (${exceptionBlocks.length}) ──`);
    exceptionBlocks.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...exceptionBlocks);
  }

  // 5. IMPORTMESSAGE — some Tally versions wrap per-record messages here
  const importMsgs = [];
  for (const m of s.matchAll(/<IMPORTMESSAGE>([\s\S]*?)<\/IMPORTMESSAGE>/gi)) {
    const msg = m[1].trim();
    if (msg) importMsgs.push(msg);
  }
  if (importMsgs.length > 0) {
    ERR(`${label} ── IMPORTMESSAGE (${importMsgs.length}) ──`);
    importMsgs.forEach((msg, i) => ERR(`${label}   [${i+1}] ${msg}`));
    errors.push(...importMsgs);
  }

  // 6. Any remaining unknown diagnostic tags — catch-all for unknown Tally versions
  //    Scan for tags we haven't explicitly handled that look like error containers
  const unknownDiagPatterns = [/<ERRMSG>([\s\S]*?)<\/ERRMSG>/gi, /<ERRORMESSAGE>([\s\S]*?)<\/ERRORMESSAGE>/gi, /<DESC>([\s\S]*?)<\/DESC>/gi];
  for (const pattern of unknownDiagPatterns) {
    for (const m of s.matchAll(pattern)) {
      const msg = m[1].trim();
      // Only log DESC if it looks like an error (contains common error keywords)
      if (msg && /error|invalid|missing|not found|cannot|reject|fail/i.test(msg)) {
        ERR(`${label} ── DIAG [${pattern.source.match(/<(\w+)>/)?.[1]}]: ${msg}`);
        errors.push(msg);
      }
    }
  }

  // ── Standard IMPORTRESULT counters ────────────────────────────────────────
  // <ERRORS> is a COUNT integer, not a message — only flag if > 0.
  if (s.includes('<ERRORS>')) {
    const m = s.match(/<ERRORS>(\d+)<\/ERRORS>/i);
    const errCount = m ? parseInt(m[1], 10) : 0;
    if (errCount > 0) {
      const msg = `Tally reported ${errCount} import error(s)`;
      errors.push(msg);
      ERR(`${label} ERRORS count: ${errCount}`);
    }
  }

  const created    = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
  const altered    = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1] || '0');
  const skipped    = parseInt(s.match(/<SKIPPED>(\d+)<\/SKIPPED>/i)?.[1] || '0');
  const exceptions = parseInt(s.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1] || '0');

  // EXCEPTIONS > 0 means Tally rejected the record(s) with a business-logic error.
  // The exact reason should now be visible above from LINEERROR / LASTERROR / EXCEPTION.
  if (exceptions > 0) {
    ERR(`${label} ── EXCEPTIONS=${exceptions} (created=${created} altered=${altered} skipped=${skipped}) ──`);
    if (lineErrors.length === 0 && lastErrors.length === 0 && exceptionBlocks.length === 0) {
      // No diagnostic tags found — this means SVSHOWERRORLIST=Yes was not effective
      // or Tally silently swallowed the message. The RAW RESPONSE above is the only clue.
      ERR(`${label} WARNING: EXCEPTIONS=${exceptions} but no diagnostic tags found in response.`);
      ERR(`${label} Review the full RAW RESPONSE logged above for clues.`);
    }
    const msg = `Tally EXCEPTIONS=${exceptions}${lineErrors.length ? ': ' + lineErrors.join(' | ') : lastErrors.length ? ': ' + lastErrors.join(' | ') : ' — see RAW RESPONSE in logs'}`;
    if (!errors.some(e => e.includes('EXCEPTIONS'))) errors.push(msg);
  }

  LOG(`${label} IMPORTRESULT → created:${created} altered:${altered} skipped:${skipped} exceptions:${exceptions} diagMsgs:${errors.length}`);

  if (errors.length > 0) {
    if (created === 0 && altered === 0) {
      ERR(`${label} FAILED:`, errors.join(' | '));
      return { ok: false, error: errors.join('; ') };
    }
    LOG(`${label} partial (${created} created, ${altered} altered). Warnings:`, errors.join(' | '));
    return { ok: true, created, altered, warning: errors.join('; ') };
  }
  return { ok: true, created, altered };
}

// ─── PO NUMBER LOOKUP: Fetch all Tally vouchers indexed by BuyersOrderNo ──────
// Called before every ERP → Tally voucher push to decide Create vs Alter.
//
// PO Number (BuyersOrderNo) is the ONLY match key.
// No Party Name, No Ledger Name, No Invoice Number matching.
//
// Returns Map<BuyersOrderNo (uppercase) → { guid, voucherNumber }>
async function fetchTallyPOMap(cfg) {
  try {
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';

    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION>
  <TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE>
  <ID>ERPVoucherPOLookup</ID>
</HEADER>
<BODY>
  <DESC>
    <STATICVARIABLES>
      ${coTag}
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="ERPVoucherPOLookup">
        <TYPE>Voucher</TYPE>
        <FETCH>GUID, VoucherNumber, VoucherTypeName, BuyersOrderNo</FETCH>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC>
</BODY>
</ENVELOPE>`;

    const resp = await postXmlWithRetry(cfg, xml, connectorTimeout(cfg, 60000));
    if (!resp) return new Map();

    const byPO = new Map();

    for (const m of resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)) {
      const block         = m[1];
      const guid          = (block.match(/<GUID>(.*?)<\/GUID>/i)?.[1]                   || '').trim();
      const voucherNumber = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]  || '').trim();
      const buyersOrderNo = (block.match(/<BUYERSORDERNO>(.*?)<\/BUYERSORDERNO>/i)?.[1]  || '').trim();

      // Only index vouchers that have a BuyersOrderNo — that is our unique key.
      // Skip vouchers without one; they are not ERP-originated or not yet tagged.
      if (guid && buyersOrderNo) {
        byPO.set(buyersOrderNo.toUpperCase().trim(), { guid, voucherNumber });
      }
    }

    LOG(`fetchTallyPOMap: ${byPO.size} vouchers found in Tally with a BuyersOrderNo`);
    return byPO;
  } catch (err) {
    ERR('fetchTallyPOMap failed (non-fatal, defaulting all to Create):', err.message);
    return new Map(); // Safe fallback — everything will be created fresh
  }
}

// ─── SYNC LOG ─────────────────────────────────────────────────────────────────

async function writeLog({ syncId, type, entity, direction, status, duration, error, records, triggeredBy }) {
  try {
    await TallySyncLog.create({
      syncId, type: type || 'Full', entity: entity || '',
      direction: direction || 'ERP → Tally',
      status, duration: duration || '0s',
      error: error || '', records: records || 0,
      triggeredBy: triggeredBy || null,
    });
  } catch (_) {}
}

// ─── TEST CONNECTION ──────────────────────────────────────────────────────────

export async function testTallyConnection() {
  // Use the improved testTallyConnection from tallyFetchEngine
  return await fetchEngineTestConnection();
}

// ─── PUSH: ALL MASTERS (Items + Customers + Vendors + Ledgers) ────────────────
// Splits into multiple batches to avoid sending a single 3MB+ payload that Tally
// cannot process within the timeout window. Each batch is ≤ MASTER_BATCH_SIZE records.
const MASTER_BATCH_SIZE = 100;  // records per Tally Import Data request
const MASTER_TIMEOUT_MS = 120000; // 2 min per batch — connector round-trip adds latency

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function wrapMastersXml(cfg, bodyXml) {
  return `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
${bodyXml}
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;
}

export async function pushMastersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-MASTERS-${Date.now()}`;
  LOG('=== pushMastersToTally START ===');

  try {
    const [items, vendors, clients, corporateClients, ledgers, pos] = await Promise.all([
      ItemMaster.find({ isActive: true, dataSource: { $ne: 'Tally' } }).lean(),
      Vendor.find({ dataSource: { $ne: 'Tally' } }).lean(),
      Client.find({ status: 'Active', dataSource: { $ne: 'Tally' } }).lean(),
      CorporateClient.find({ status: 'Active', dataSource: { $ne: 'Tally' } }).lean(),
      AccountsLedger.find({ isActive: true, dataSource: { $ne: 'Tally' } }).lean(),
      PurchaseOrder.find({ status: { $in: ['Approved','Received'] } }).lean(),
    ]);

    // ── Build per-record XML fragments ──────────────────────────────────────
    const stockItemFragments = items.map(item => `
<STOCKITEM NAME="${esc(item.name)}" ACTION="${item.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(item.name)}</NAME>
  <UNITS>${tallyUnit(item.unit)}</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>${esc(item.hsn || '')}</HSNCODE>
  <GSTRATE>${item.gst || 0}</GSTRATE>
  ${item.tallyGuid ? `<GUID>${esc(item.tallyGuid)}</GUID>` : ''}
</STOCKITEM>`);

    // Extra items from POs not in ItemMaster
    const knownNames = new Set(items.map(i => i.name));
    const extraNames = new Set();
    for (const po of pos) {
      for (const it of (po.items || [])) {
        if (it.name && !knownNames.has(it.name)) extraNames.add(it.name.trim());
      }
    }
    const extraItemFragments = [...extraNames].map(name => `
<STOCKITEM NAME="${esc(name)}" ACTION="Create">
  <NAME>${esc(name)}</NAME><UNITS>Nos</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
</STOCKITEM>`);

    const allStockFragments = [...stockItemFragments, ...extraItemFragments];

    // ── System Ledgers (always in first batch) ───────────────────────────────
    // ACTION="Create" — Tally silently skips these if they already exist.
    // Never send OPENINGBALANCE — it resets the client's balance on a newly created ledger
    // or can interfere with Tally's own GST setup if the ledger is created fresh.
    const systemLedgerFragments = [
      `<LEDGER NAME="Purchase Accounts" ACTION="Create"><NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
    ];

    const vendorFragments = vendors.map(v => `
<LEDGER NAME="${esc(v.companyName)}" ACTION="${v.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(v.companyName)}</NAME>
  <PARENT>Sundry Creditors</PARENT>
  <GSTREGISTRATIONTYPE>${v.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(v.gstNumber || '')}</PARTYGSTIN>
  <EMAIL>${esc(v.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(v.phone || '')}</LEDGERMOBILE>
  <MAILINGNAME>${esc(v.contactPerson || v.companyName)}</MAILINGNAME>
  ${v.tallyGuid ? `<GUID>${esc(v.tallyGuid)}</GUID>` : ''}
</LEDGER>`);

    const allClients = [
      ...clients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, guid: c.tallyGuid, openingBalance: c.outstanding || 0 })),
      ...corporateClients.map(c => ({ name: c.name, gst: c.gstNumber, phone: c.phone, email: c.email, guid: c.tallyGuid || c.tallyLedgerId, openingBalance: c.accountsLedger?.openingBalance || 0 })),
    ];
    const clientFragments = allClients.map(c => `
<LEDGER NAME="${esc(c.name)}" ACTION="${c.guid ? 'Alter' : 'Create'}">
  <NAME>${esc(c.name)}</NAME>
  <PARENT>Sundry Debtors</PARENT>
  <GSTREGISTRATIONTYPE>${c.gst ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(c.gst || '')}</PARTYGSTIN>
  <EMAIL>${esc(c.email || '')}</EMAIL>
  <LEDGERMOBILE>${esc(c.phone || '')}</LEDGERMOBILE>
  ${c.guid ? `<GUID>${esc(c.guid)}</GUID>` : ''}
</LEDGER>`);

    const tallyParent = (g) => {
      const s = (g||'').toLowerCase();
      if (s.includes('creditor')) return 'Sundry Creditors';
      if (s.includes('debtor'))   return 'Sundry Debtors';
      if (s.includes('bank'))     return 'Bank Accounts';
      if (s.includes('cash'))     return 'Cash-in-Hand';
      if (s.includes('expense'))  return 'Indirect Expenses';
      if (s.includes('income'))   return 'Indirect Incomes';
      return 'Sundry Debtors';
    };
    const acctLedgerFragments = ledgers.map(l => `
<LEDGER NAME="${esc(l.ledgerName)}" ACTION="${l.tallyGuid ? 'Alter' : 'Create'}">
  <NAME>${esc(l.ledgerName)}</NAME>
  <PARENT>${esc(tallyParent(l.ledgerGroup))}</PARENT>
  <GSTREGISTRATIONTYPE>${l.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(l.gstNumber || '')}</PARTYGSTIN>
  ${l.tallyGuid ? `<GUID>${esc(l.tallyGuid)}</GUID>` : ''}
</LEDGER>`);

    // ── Build batches ────────────────────────────────────────────────────────
    // Batch 1: system ledgers + first N stock items (system ledgers are tiny, always first)
    // Subsequent batches: remaining items, then vendors, clients, account ledgers
    const allLedgerFragments = [
      ...systemLedgerFragments,
      ...vendorFragments,
      ...clientFragments,
      ...acctLedgerFragments,
    ];

    const batches = [
      ...chunkArray(allStockFragments, MASTER_BATCH_SIZE),
      ...chunkArray(allLedgerFragments, MASTER_BATCH_SIZE),
    ].filter(b => b.length > 0);

    LOG(`Masters split into ${batches.length} batches (items:${allStockFragments.length} ledgers:${allLedgerFragments.length})`);

    // ── Send each batch sequentially ─────────────────────────────────────────
    let totalCreated = 0, totalAltered = 0;
    const errors = [];

    for (let i = 0; i < batches.length; i++) {
      const batchXml = wrapMastersXml(cfg, batches[i].join(''));
      LOG(`Sending batch ${i + 1}/${batches.length} (${batches[i].length} records, ${batchXml.length} bytes)`);
      try {
        const resp   = await postXmlWithRetry(cfg, batchXml, connectorTimeout(cfg, MASTER_TIMEOUT_MS), 2);
        const result = parseTallyResponse(resp, `Masters batch ${i + 1}/${batches.length}`);
        totalCreated += result.created || 0;
        totalAltered += result.altered || 0;
        if (!result.ok && result.error) errors.push(`Batch ${i + 1}: ${result.error}`);
      } catch (batchErr) {
        ERR(`Masters batch ${i + 1} failed: ${batchErr.message}`);
        errors.push(`Batch ${i + 1}: ${batchErr.message}`);
      }
    }

    const records  = items.length + vendors.length + allClients.length + ledgers.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    const ok       = errors.length === 0;

    await writeLog({ syncId, type:'Item Master', direction:'ERP → Tally', status: ok ? 'Success' : 'Failed', duration, error: errors.join('; '), records, triggeredBy });
    if (ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
      await AccountsLedger.updateMany({ isActive:true }, { syncedWithTally:true, lastTallySync:new Date() });
      LOG(`Masters synced OK — ${records} records in ${duration} (created:${totalCreated} altered:${totalAltered})`);
    } else {
      LOG(`Masters sync partial — ${errors.length} batch(es) failed in ${duration}`);
    }
    return { ok, records, error: errors.length ? errors.join('; ') : undefined };

  } catch (err) {
    ERR('pushMastersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

export const pushItemsToTally   = (cfg, t) => pushMastersToTally(cfg, t);
export const pushLedgersToTally = (cfg, t) => pushMastersToTally(cfg, t);

// ─── PUSH: PURCHASE VOUCHERS (POs) ───────────────────────────────────────────

export async function pushPurchaseVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PUR-${Date.now()}`;
  LOG('=== pushPurchaseVouchersToTally START ===');
  try {
    // Only push POs not yet synced that were created in the ERP (not imported from Tally)
    const pos = await PurchaseOrder.find({
      status: { $in:['Approved','Received'] },
      dataSource: { $ne: 'Tally' },
    }).populate('vendor').lean();

    if (!pos.length) {
      await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    // ── Step 1: Auto-create required ledgers & stock items before vouchers ───
    // Collect unique vendor names and stock item names from all POs
    const vendorNames = [...new Set(pos.map(po => po.vendor?.companyName).filter(Boolean))];
    const poStockNames = [...new Set(
      pos.flatMap(po => (po.items||[]).map(i => (i.name||'').trim())).filter(Boolean)
    )];

    const purAutoLedgerXml = [
      `<LEDGER NAME="Purchase Accounts" ACTION="Create"><NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      ...vendorNames.map(name =>
        `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>Sundry Creditors</PARENT></LEDGER>`
      ),
    ].join('');

    const purAutoStockXml = poStockNames.map(name =>
      `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><UNITS>Nos</UNITS></STOCKITEM>`
    ).join('');

    LOG(`Purchase: auto-creating ${vendorNames.length} vendor ledgers + ${poStockNames.length} stock items before vouchers`);
    const purMastersXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${purAutoLedgerXml}${purAutoStockXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
    const purMastersResp = await postXmlWithRetry(cfg, purMastersXml, connectorTimeout(cfg, 60000));
    parseTallyResponse(purMastersResp, 'Purchase Auto-Masters');  // log result, don't abort

    // ── Step 2: Fetch existing Tally vouchers indexed by PO Number ──────────
    // This lets us decide Create vs Alter per voucher, regardless of tallySync flag.
    const tallyPOMap = await fetchTallyPOMap(cfg);
    LOG(`pushPurchaseVouchersToTally: ${pos.length} POs to process, ${tallyPOMap.size} PO numbers already in Tally`);

    const today = tallyDate(new Date());
    const vouchersXml = pos.map(po => {
      const vendorName = po.vendor?.companyName || 'Unknown Vendor';
      const date       = tallyDate(po.createdAt) || tallyDate(po.orderDate) || today;
      const itemsTotal = (po.items||[]).reduce((s,it)=>s+(it.qty||1)*(it.basePrice||0),0);
      const gstAmt     = +(po.gstTotal||0).toFixed(2);
      const grandTot   = +(po.grandTotal||itemsTotal+gstAmt).toFixed(2);
      const cgstAmt    = +(gstAmt/2).toFixed(2);
      const sgstAmt    = +(gstAmt-cgstAmt).toFixed(2);

      // ── Step 2: Match by PO Number ONLY ─────────────────────────────────
      const poNumber = (po.poId || '').toUpperCase().trim();
      const existing = poNumber ? tallyPOMap.get(poNumber) : null;
      const action   = existing ? 'Alter' : 'Create';
      const guidTag  = existing ? `<GUID>${esc(existing.guid)}</GUID>` : '';
      LOG(`PO ${po.poId}: action=${action}${existing ? ` (Tally GUID: ${existing.guid})` : ' (new)'}`);

      const itemsXml = (po.items||[]).map(item => {
        const qty   = +(item.qty||item.quantity||1);
        const rate  = +(item.basePrice||item.unitPrice||item.rate||0);
        const total = +(qty*rate).toFixed(2);
        const iUnit = tallyUnit(item.unit || 'Nos');
        // Purchase: stock comes IN → ISDEEMEDPOSITIVE=Yes, AMOUNT=positive
        // ACCOUNTINGALLOCATIONS: Purchase Accounts is debited → Yes, positive
        return `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(item.name||'Unknown Item')}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <RATE>${rate}/${iUnit}</RATE><AMOUNT>${total}</AMOUNT>
  <ACTUALQTY>${qty} ${iUnit}</ACTUALQTY><BILLEDQTY>${qty} ${iUnit}</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${total}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
      }).join('');

      return `
<VOUCHER VCHTYPE="Purchase" ACTION="${action}">
  <DATE>${date}</DATE>
  ${guidTag}
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(po.poId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(vendorName)}</PARTYLEDGERNAME>
  <BUYERSORDERNO>${esc(po.poId)}</BUYERSORDERNO>
  <NARRATION>PO: ${esc(po.poId)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(vendorName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${grandTot}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgstAmt>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${cgstAmt}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${sgstAmt>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>${sgstAmt}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${itemsXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postXmlWithRetry(cfg, xml, connectorTimeout(cfg, 30000));
    const result  = parseTallyResponse(resp, 'Purchase Vouchers');
    const records = pos.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
      await PurchaseOrder.updateMany({ _id:{$in:pos.map(p=>p._id)} }, { tallySync:true, tallySyncAt:new Date() });
    }
    return { ok:result.ok, records, error:result.error };
  } catch (err) {
    ERR('pushPurchaseVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Purchase', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PUSH: SALES (INVOICE) VOUCHERS ──────────────────────────────────────────
// Enhanced format matching Tally Sales Register XML structure with full GST compliance

export async function pushSalesVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-SALES-${Date.now()}`;
  LOG('=== pushSalesVouchersToTally START (Enhanced Format) ===');
  try {
    // Only export invoices not yet synced to Tally (tallySync !== true).
    // This prevents duplicate vouchers when "Export to Tally" is clicked multiple times.
    // New Excel-uploaded invoices start with tallySync=false/undefined → eligible.
    // Successfully exported invoices have tallySync=true → skipped automatically.
    const invoices = await Invoice.find({
      status:    { $nin: ['Cancelled'] },
      source:    { $nin: ['Tally', 'tally'] },
      tallySync: { $ne: true },
    }).lean();

    if (!invoices.length) {
      await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    LOG(`pushSalesVouchersToTally: ${invoices.length} invoices pending export (tallySync=false/null)`);
    LOG(`First invoice: no=${invoices[0].invoiceNo} source=${invoices[0].source} tallySync=${invoices[0].tallySync}`);

    // ── Step 1: Auto-create required ledgers & stock items in the same request ──
    // Tally requires party ledger + Sales Accounts + CGST/SGST/IGST + stock items
    // to exist BEFORE voucher entries can reference them.
    // We embed ledger/item CREATE statements in the same TALLYMESSAGE so they are
    // created atomically before the vouchers are processed.
    // ACTION="Create" — Tally silently skips records that already exist.

    // Collect unique party names from all invoices
    const partyNames = [...new Set(invoices.map(inv => inv.partyName).filter(Boolean))];
    // Collect unique stock item names from all invoice lines
    const stockNames = [...new Set(
      invoices.flatMap(inv => (inv.items||[]).map(i => (i.description||i.name||'').trim())).filter(Boolean)
    )];

    const autoLedgerXml = [
      // System ledgers — Tally skips if already present
      `<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="Output CGST @ 2.5%" ACTION="Create"><NAME>Output CGST @ 2.5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output SGST @ 2.5%" ACTION="Create"><NAME>Output SGST @ 2.5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output CGST @ 6%" ACTION="Create"><NAME>Output CGST @ 6%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output SGST @ 6%" ACTION="Create"><NAME>Output SGST @ 6%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output CGST @ 9%" ACTION="Create"><NAME>Output CGST @ 9%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output SGST @ 9%" ACTION="Create"><NAME>Output SGST @ 9%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output IGST @ 5%" ACTION="Create"><NAME>Output IGST @ 5%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output IGST @ 12%" ACTION="Create"><NAME>Output IGST @ 12%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output IGST @ 18%" ACTION="Create"><NAME>Output IGST @ 18%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      // Party ledgers — one per unique customer; Tally skips if already present
      ...partyNames.map(name =>
        `<LEDGER NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>`
      ),
    ].join('');

    const autoStockXml = stockNames.map(name =>
      `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><UNITS>Nos</UNITS><GSTAPPLICABLE>Applicable</GSTAPPLICABLE><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY></STOCKITEM>`
    ).join('');

    LOG(`Sales: auto-creating ${partyNames.length} party ledgers + ${stockNames.length} stock items before vouchers`);

    // ── Step 2: Fetch existing Tally vouchers indexed by PO Number ──────────
    // Determines whether to Create (new PO) or Alter (existing PO) each voucher.
    const tallyPOMap = await fetchTallyPOMap(cfg);
    LOG(`pushSalesVouchersToTally: ${invoices.length} invoices to process, ${tallyPOMap.size} PO numbers already in Tally`);

    const vouchersXml = invoices.map((inv, idx) => {
      // ── Amount calculation ──────────────────────────────────────────────────
      // Tally requires: partyLedger + gstLedgers + salesLedger(s) = 0 (balanced).
      //
      // Formula:
      //   partyLedger (debit/positive)  = grandTotal
      //   CGST/SGST/IGST (credit/neg)   = tax amounts
      //   Sales Accounts (credit/neg)   = grandTotal - totalTax  [computed, not from items]
      //
      // We derive salesBase from grandTotal to guarantee balance regardless of any
      // rounding in item-level amounts. This is the Tally-standard approach.

      // ── Build voucher: Item Invoice format ──────────────────────────────
      // ALLINVENTORYENTRIES.LIST is populated below when items are available,
      // making Tally treat this as an Item Invoice (Name of Item / Qty / Rate).
      // When no items are present, falls back to pure-accounting format.
      const grandTotal  = +((inv.grandTotal || inv.totalAmount || 0)).toFixed(2);
      let   cgst        = +((inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0))).toFixed(2);
      let   sgst        = +((inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0))).toFixed(2);
      let   igst        = +((inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0))).toFixed(2);
      const totalTax    = +(cgst + sgst + igst).toFixed(2);
      const salesBase   = +(grandTotal - totalTax).toFixed(2);

      // GST ledger name resolution (matches existing Tally ledger names)
      const taxableBase  = salesBase > 0 ? salesBase : grandTotal;
      const cgstHalfRate = (taxableBase > 0 && cgst > 0) ? +((cgst / taxableBase) * 100).toFixed(2) : 0;
      const igstFullRate = (taxableBase > 0 && igst > 0) ? +((igst / taxableBase) * 100).toFixed(2) : 0;
      const cgstLedger   = cgstHalfRate <= 2.5 && cgst > 0 ? 'Output CGST @ 2.5%'
                         : cgstHalfRate <= 6   ? 'Output CGST @ 6%'
                         : cgst > 0            ? 'Output CGST @ 9%' : '';
      const sgstLedger   = cgstLedger.replace('CGST','SGST');
      const igstLedger   = igstFullRate <= 5  && igst > 0 ? 'Output IGST @ 5%'
                         : igstFullRate <= 12  ? 'Output IGST @ 12%'
                         : igst > 0            ? 'Output IGST @ 18%' : '';

      // ── Determine Create vs Alter ───────────────────────────────────────
      const poNumber = (inv.buyersOrderNo || '').toUpperCase().trim();
      const existing = poNumber ? tallyPOMap.get(poNumber) : null;
      const action   = (existing || inv.tallyGuid) ? 'Alter' : 'Create';
      const guidVal  = existing?.guid || inv.tallyGuid || null;
      const guidTag  = guidVal ? `<GUID>${esc(guidVal)}</GUID>` : '';
      LOG(`Invoice ${inv.invoiceNo}: action=${action} grandTotal=${grandTotal} cgst=${cgst} sgst=${sgst} igst=${igst}`);

      // ── Always use TODAY as Tally voucher date ──────────────────────
      // Invoice date from Excel may be in a past period — using today guarantees
      // the voucher always falls within Tally's active accounting period.
      // Original date is preserved in DB, shown in ERP UI, and included in narration.
      const voucherDate  = tallyDate(new Date()); // always today
      const origDateFmt  = inv.invoiceDate
        ? new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
        : '';

      // Narration: free text only — item names and PO are in structured XML fields
      const narration = [
        `ERP Inv: ${inv.invoiceNo}`,
        origDateFmt ? `Original Invoice Date: ${origDateFmt}` : null,
        inv.notes || null,
      ].filter(Boolean).join(' | ');

      // Build ALLINVENTORYENTRIES.LIST — only when items have a real sales ledger.
      // "Sales Accounts" is a Tally group, not a ledger: using it in ACCOUNTINGALLOCATIONS
      // causes silent EXCEPTIONS=1. Skip inventory when no specific ledger is set.
      const batchInvItems = (inv.items || []).filter(i => (i.description || i.name || '').trim());
      const batchItemAmounts = batchInvItems.map(i => {
        const qty  = +(i.qty || 1);
        const rate = +(i.rate || 0);
        return +(i.amount || i.basic || (qty * rate)).toFixed(2);
      });
      const batchItemsTotal = +batchItemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
      const useBatchInventory = batchInvItems.length > 0
        && Math.abs(batchItemsTotal - salesBase) <= 0.10
        && batchInvItems.some(i => {
          const l = (i.tallySalesLedger || '').trim().toLowerCase();
          return l && l !== 'sales accounts';
        });
      let batchInvAllocated = 0;
      const batchInventoryXml = useBatchInventory ? batchInvItems.map((item, i) => {
        const itemName    = (item.description || item.name || '').trim();
        const itemQty     = +(item.qty || 1);
        const itemRate    = +(item.rate || 0);
        const isLast      = i === batchInvItems.length - 1;
        const itemAmt     = isLast
          ? +(salesBase - batchInvAllocated).toFixed(2)
          : batchItemAmounts[i];
        batchInvAllocated = +(batchInvAllocated + (isLast ? itemAmt : batchItemAmounts[i])).toFixed(2);
        const itemUnit    = 'Nos';
        const salesLedger = (item.tallySalesLedger || '').trim();
        return `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>${itemRate.toFixed(2)}/${itemUnit}</RATE>
    <AMOUNT>${itemAmt.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${itemQty} ${itemUnit}</ACTUALQTY>
    <BILLEDQTY>${itemQty} ${itemUnit}</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>${itemAmt.toFixed(2)}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>`;
      }).join('') : '';

      // ── Bill To / Ship To — stripped pending confirmed-working test ──────────
      const batchBillToXml = '';
      const batchShipToXml = '';

      const vXml = `
<VOUCHER VCHTYPE="Sales" ACTION="${action}" OBJVIEW="Invoice Voucher View">
  <DATE>${voucherDate}</DATE>
  <EFFECTIVEDATE>${voucherDate}</EFFECTIVEDATE>
  ${guidTag}
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <BUYERSORDERNO>${esc(inv.purchaseOrderRef || inv.buyersOrderNo || '')}</BUYERSORDERNO>
  <NARRATION>${esc(narration)}</NARRATION>
  ${batchBillToXml}
  ${batchShipToXml}
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(inv.invoiceNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  ${cgst > 0 && cgstLedger ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(cgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${sgst > 0 && sgstLedger ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(sgstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${igst > 0 && igstLedger ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(igstLedger)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${igst.toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${!useBatchInventory ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${(totalTax > 0 ? salesBase : grandTotal).toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${batchInventoryXml}
</VOUCHER>`;

      if (idx === 0) LOG(`pushSalesVouchersToTally: FIRST INVOICE XML:\n${vXml}`);
      return { id: inv._id, xml: vXml };
    }).filter(Boolean);

    // ── Step 3: Send masters first, then vouchers one-by-one ──────────────
    const mastersXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${autoLedgerXml}${autoStockXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    LOG(`Sales: pushing masters first (${partyNames.length} ledgers)`);
    const mastersResp = await postXmlWithRetry(cfg, mastersXml, connectorTimeout(cfg, 60000));
    parseTallyResponse(mastersResp, 'Sales Auto-Masters');

    // Send each voucher individually — avoids Tally payload size limits
    // and ensures each invoice appears as a separate entry in Sales Register
    let totalCreated = 0, totalAltered = 0;
    const batchErrors = [];
    const successIds  = [];

    for (const voucher of vouchersXml) {
      const singleXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucher.xml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
      const resp   = await postXmlWithRetry(cfg, singleXml, connectorTimeout(cfg, 30000));
      const result = parseTallyResponse(resp, `Sales Voucher`);
      if (result.ok) {
        totalCreated += result.created || 0;
        totalAltered += result.altered || 0;
        successIds.push(voucher.id);
      } else {
        batchErrors.push(result.error || 'unknown');
      }
    }

    const records  = invoices.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    const overallOk = batchErrors.length === 0;

    await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status: overallOk?'Success':'Failed', duration, error: batchErrors.join('; '), records, triggeredBy });

    if (successIds.length > 0) {
      await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
      await Invoice.updateMany({ _id:{$in:successIds} }, { tallySync:true, tallySyncAt:new Date() });
    }

    LOG(`pushSalesVouchersToTally: ${successIds.length}/${records} exported in ${duration}. Errors: ${batchErrors.length}`);
    return { ok: overallOk, records, created: totalCreated, altered: totalAltered, error: batchErrors.length ? batchErrors.join('; ') : undefined };
  } catch (err) {
    ERR('pushSalesVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Sales', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PUSH: SINGLE INVOICE TO TALLY (ERP → Tally) ────────────────────────────
// Pushes one specific invoice by its MongoDB _id.
// Called from the "Send to Tally" button on the invoice list.
// PRIMARY PATH: uses stored tallyVoucher sub-document (zero field mapping).
// FALLBACK PATH: legacy field-mapping if tallyVoucher is null (legacy invoice).

function buildSingleVoucherXml(inv, cfg) {
  // Minimal XML serializer for the stored tallyVoucher sub-document
  const v = inv.tallyVoucher?.toObject ? inv.tallyVoucher.toObject() : inv.tallyVoucher;
  const action  = inv.tallyGuid ? 'Alter' : 'Create';
  const guidTag = inv.tallyGuid ? `<GUID>${esc(inv.tallyGuid)}</GUID>` : '';

  // Only include inventory entries that have a real (non-group) sales ledger.
  // "Sales Accounts" in ACCOUNTINGALLOCATIONS causes silent EXCEPTIONS=1 because
  // it's a Tally group, not a ledger. Items without a specific ledger fall through
  // to the plain ledger-only format — their credit is in LEDGERENTRIES.LIST.
  const validInventoryEntries = (v.allInventoryEntries || []).filter(item => {
    if (!item.stockItemName) return false;
    const allocLedger = (item.accountingAllocations?.[0]?.ledgerName || '').toLowerCase().trim();
    return allocLedger && allocLedger !== 'sales accounts';
  });
  const hasInventoryEntries = validInventoryEntries.length > 0;

  const ledgerEntriesXml = (v.allLedgerEntries || []).map(entry => {
    // When inventory entries are present, omit the Sales Accounts ledger entry to
    // prevent double-booking (inventory entries carry the sales value).
    if (hasInventoryEntries) {
      const name = (entry.ledgerName || '').toLowerCase().trim();
      if (name === 'sales accounts') return '';
    }
    const billAllocsXml = (entry.billAllocations || []).map(ba => `
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(ba.name || '')}</NAME>
      <BILLTYPE>${esc(ba.billType || 'New Ref')}</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>${(ba.amount || 0).toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>`).join('');
    return `
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(entry.ledgerName || '')}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>${entry.isLastDeemedPositive ? 'Yes' : 'No'}</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>${entry.isDeemedPositive ? 'Yes' : 'No'}</ISPARTYLEDGER>
    <AMOUNT>${(entry.amount || 0).toFixed(2)}</AMOUNT>${billAllocsXml}
  </LEDGERENTRIES.LIST>`;
  }).join('');

  const inventoryEntriesXml = validInventoryEntries.map(item => {
    const absAmount = Math.abs(item.amount || 0);
    const acctAllocsXml = (item.accountingAllocations || []).map(aa => `
      <ACCOUNTINGALLOCATIONS.LIST>
        <LEDGERNAME>${esc(aa.ledgerName || '')}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>${aa.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
        <ISLASTDEEMEDPOSITIVE>${aa.isLastDeemedPositive ? 'Yes' : 'No'}</ISLASTDEEMEDPOSITIVE>
        <AMOUNT>${Math.abs(aa.amount || 0).toFixed(2)}</AMOUNT>
      </ACCOUNTINGALLOCATIONS.LIST>`).join('');

    const gstLedgerSrc = (item.gstLedgerSource || item.accountingAllocations?.[0]?.ledgerName || '').trim();
    const hsnLedgerSrc = (item.hsnLedgerSource || gstLedgerSrc).trim();
    const gstHsnName   = (item.gstHsnName || '').trim();
    const isGenericLedger = !gstLedgerSrc
      || gstLedgerSrc.toLowerCase() === 'sales accounts'
      || gstLedgerSrc === (item.stockItemName || '').trim();
    const gstSourceXml = !isGenericLedger ? `<GSTSOURCETYPE>${esc(item.gstSourceType || 'Ledger')}</GSTSOURCETYPE>
    <GSTLEDGERSOURCE>${esc(gstLedgerSrc)}</GSTLEDGERSOURCE>` : '';
    const hsnSourceXml = !isGenericLedger && hsnLedgerSrc ? `<HSNSOURCETYPE>${esc(item.hsnSourceType || 'Ledger')}</HSNSOURCETYPE>
    <HSNLEDGERSOURCE>${esc(hsnLedgerSrc)}</HSNLEDGERSOURCE>` : '';
    // Only emit GST override tags alongside a real GSTLEDGERSOURCE.
    // Emitting them without a source causes silent EXCEPTIONS=1.
    const gstOverrideXml = !isGenericLedger
      ? `<GSTOVRDNTAXABILITY>${esc(item.gstOverrideTaxability || 'Taxable')}</GSTOVRDNTAXABILITY>
    <GSTOVRDNTYPEOFSUPPLY>${esc(item.gstOverrideSupplyType || 'Goods')}</GSTOVRDNTYPEOFSUPPLY>`
      : '';

    return `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(item.stockItemName || '')}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>${item.isDeemedPositive ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>${item.isLastDeemedPositive ? 'Yes' : 'No'}</ISLASTDEEMEDPOSITIVE>
    <RATE>${esc(item.rate || '')}</RATE>
    <AMOUNT>${absAmount.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${esc(item.actualQty || '')}</ACTUALQTY>
    <BILLEDQTY>${esc(item.billedQty || '')}</BILLEDQTY>
    ${gstSourceXml}
    ${hsnSourceXml}
    ${gstOverrideXml}
    ${gstHsnName ? `<GSTHSNNAME>${esc(gstHsnName)}</GSTHSNNAME>` : ''}${acctAllocsXml}
  </ALLINVENTORYENTRIES.LIST>`;
  }).join('');

  // ── Bill-to / Ship-to — stripped pending confirmed-working test ────────────
  const billToName = (v.billToName || v.partyLedgerName || '').trim(); // kept for reference only
  const billToXml  = '';
  const shipToXml  = '';

  const poDateXml = v.poDate ? `<BASICORDERDATE>${esc(v.poDate)}</BASICORDERDATE>` : '';

  return `
<VOUCHER VCHTYPE="${esc(v.voucherType || 'Sales')}" ACTION="${action}" OBJVIEW="Invoice Voucher View">
  <DATE>${esc(v.date || '')}</DATE>
  <EFFECTIVEDATE>${esc(v.effectiveDate || v.date || '')}</EFFECTIVEDATE>
  ${guidTag}
  <VOUCHERTYPENAME>${esc(v.voucherType || 'Sales')}</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(v.voucherNumber || '')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(v.partyLedgerName || '')}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <BUYERSORDERNO>${esc(v.buyersOrderNo || '')}</BUYERSORDERNO>
  ${poDateXml}
  <NARRATION>${esc(v.narration || '')}</NARRATION>${billToXml}${shipToXml}${ledgerEntriesXml}${inventoryEntriesXml}
</VOUCHER>`;
}

export async function pushSingleInvoiceToTally(invoiceId) {
  const start  = Date.now();
  const syncId = `SYNC-INV-${Date.now()}`;
  LOG(`=== pushSingleInvoiceToTally START: ${invoiceId} ===`);

  try {
    const cfg = await getConfig();
    const hasConnection = cfg?.useConnector && cfg?.connectorId
      ? true
      : !!(cfg?.tallyLocalUrl);
    if (!hasConnection) {
      return { ok: false, error: 'Tally not configured. Set Tally URL or enable Connector in Settings.' };
    }

    const inv = await Invoice.findById(invoiceId).lean();
    if (!inv) return { ok: false, error: 'Invoice not found' };

    const grandTotal = +((inv.grandTotal || inv.totalAmount || 0)).toFixed(2);
    if (!grandTotal) return { ok: false, error: 'Invoice has zero amount — cannot push to Tally' };
    if (!inv.partyName) return { ok: false, error: 'Invoice has no party name — cannot push to Tally' };

    // ── Auto-create party ledger + system ledgers + stock items ─────────
    const stockNames = [...new Set(
      (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean)
    )];
    const autoLedgerXml = [
      `<LEDGER NAME="Sales Accounts" ACTION="Create"><NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT></LEDGER>`,
      `<LEDGER NAME="CGST" ACTION="Create"><NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="SGST" ACTION="Create"><NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="IGST" ACTION="Create"><NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output CGST @ 9%" ACTION="Create"><NAME>Output CGST @ 9%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output SGST @ 9%" ACTION="Create"><NAME>Output SGST @ 9%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="Output IGST @ 18%" ACTION="Create"><NAME>Output IGST @ 18%</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE></LEDGER>`,
      `<LEDGER NAME="${esc(inv.partyName)}" ACTION="Create"><NAME>${esc(inv.partyName)}</NAME><PARENT>Sundry Debtors</PARENT></LEDGER>`,
    ].join('');
    const autoStockXml = stockNames.map(name =>
      `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><NAME>${esc(name)}</NAME><UNITS>Nos</UNITS></STOCKITEM>`
    ).join('');
    const mastersXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${autoLedgerXml}${autoStockXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
    const mastersResp = await postXmlWithRetry(cfg, mastersXml, connectorTimeout(cfg, 60000));
    parseTallyResponse(mastersResp, `Invoice ${inv.invoiceNo} Auto-Masters`);

    // ── Build voucher XML ────────────────────────────────────────────────
    // PRIMARY PATH: serialize stored tallyVoucher sub-document
    // FALLBACK: legacy field-mapping if tallyVoucher is null
    let voucherXml;

    if (inv.tallyVoucher && inv.tallyVoucher.voucherNumber) {
      LOG(`Invoice ${inv.invoiceNo}: PRIMARY path — using stored tallyVoucher`);
      // Ensure tallyVoucher is current (re-normalize if needed)
      let tv = inv.tallyVoucher;
      if (!tv.date) {
        // Date might be missing on very old stored vouchers — re-normalize
        try {
          // Enrich items with ItemMaster tallySalesLedger + hsn before re-normalizing
          const itemNames = (inv.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean);
          const itemMasters = itemNames.length
            ? await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn tallySalesLedger').lean()
            : [];
          const masterMap = new Map(itemMasters.map(m => [m.name, m]));
          const enrichedItems = (inv.items || []).map(item => {
            const name = (item.description || item.name || '').trim();
            const im   = masterMap.get(name);
            return { ...item, hsn: item.hsn || im?.hsn || '', tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '' };
          });
          const fresh = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd: cfg.tallyPeriodEnd || null });
          tv = fresh;
          await Invoice.findByIdAndUpdate(invoiceId, { tallyVoucher: fresh });
        } catch (normErr) {
          LOG(`Re-normalize failed (non-fatal): ${normErr.message}`);
        }
      }
      voucherXml = buildSingleVoucherXml({ ...inv, tallyVoucher: tv }, cfg);

    } else {
      // ── FALLBACK: legacy field-mapping ───────────────────────────────
      LOG(`Invoice ${inv.invoiceNo}: FALLBACK path — tallyVoucher=null, using legacy mapper`);
      const cgst      = +((inv.cgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0))).toFixed(2);
      const sgst      = +((inv.sgstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0))).toFixed(2);
      const igst      = +((inv.igstTotal ?? (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0))).toFixed(2);
      const totalTax  = +(cgst + sgst + igst).toFixed(2);
      const salesBase = +(grandTotal - totalTax).toFixed(2);
      const taxableBase = salesBase > 0 ? salesBase : grandTotal;
      const cgstHRate = (taxableBase > 0 && cgst > 0) ? +((cgst/taxableBase)*100).toFixed(2) : 0;
      const igstFRate = (taxableBase > 0 && igst > 0) ? +((igst/taxableBase)*100).toFixed(2) : 0;
      const cgstLed   = cgstHRate<=2.5&&cgst>0 ? 'Output CGST @ 2.5%' : cgstHRate<=6 ? 'Output CGST @ 6%' : cgst>0 ? 'Output CGST @ 9%' : '';
      const sgstLed   = cgstLed.replace('CGST','SGST');
      const igstLed   = igstFRate<=5&&igst>0 ? 'Output IGST @ 5%' : igstFRate<=12 ? 'Output IGST @ 12%' : igst>0 ? 'Output IGST @ 18%' : '';

      const voucherTallyDate = tallyDate(new Date());
      const existingGuid = inv.tallyGuid || null;
      const action  = existingGuid ? 'Alter' : 'Create';
      const guidTag = existingGuid ? `<GUID>${esc(existingGuid)}</GUID>` : '';
      const origFmt = inv.invoiceDate
        ? new Date(inv.invoiceDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
        : '';
      const narration = [
        `ERP Inv: ${inv.invoiceNo}`,
        origFmt ? `Original Invoice Date: ${origFmt}` : null,
        inv.notes || null,
      ].filter(Boolean).join(' | ');

      // Build ALLINVENTORYENTRIES.LIST — only when items have a real sales ledger.
      // "Sales Accounts" is a Tally group, not a ledger: using it in ACCOUNTINGALLOCATIONS
      // causes silent EXCEPTIONS=1. Skip inventory when no specific ledger is set.
      const invItems = (inv.items || []).filter(i => (i.description || i.name || '').trim());
      const invItemAmounts = invItems.map(i => {
        const qty  = +(i.qty || 1);
        const rate = +(i.rate || 0);
        return +(i.amount || i.basic || (qty * rate)).toFixed(2);
      });
      const invItemsTotal = +invItemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
      const useLegacyInventory = invItems.length > 0
        && Math.abs(invItemsTotal - salesBase) <= 0.10
        && invItems.some(i => {
          const l = (i.tallySalesLedger || '').trim().toLowerCase();
          return l && l !== 'sales accounts';
        });
      let legacyInvAllocated = 0;
      const legacyInventoryXml = useLegacyInventory ? invItems.map((item, i) => {
        const itemName    = (item.description || item.name || '').trim();
        const itemQty     = +(item.qty || 1);
        const itemRate    = +(item.rate || 0);
        const isLast      = i === invItems.length - 1;
        const itemAmt     = isLast
          ? +(salesBase - legacyInvAllocated).toFixed(2)
          : invItemAmounts[i];
        legacyInvAllocated = +(legacyInvAllocated + (isLast ? itemAmt : invItemAmounts[i])).toFixed(2);
        const itemUnit    = 'Nos';
        const salesLedger = (item.tallySalesLedger || '').trim();
        return `
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
    <RATE>${itemRate.toFixed(2)}/${itemUnit}</RATE>
    <AMOUNT>${itemAmt.toFixed(2)}</AMOUNT>
    <ACTUALQTY>${itemQty} ${itemUnit}</ACTUALQTY>
    <BILLEDQTY>${itemQty} ${itemUnit}</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLedger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
      <AMOUNT>${itemAmt.toFixed(2)}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>`;
      }).join('') : '';

      voucherXml = `
<VOUCHER VCHTYPE="Sales" ACTION="${action}" OBJVIEW="Invoice Voucher View">
  <DATE>${voucherTallyDate}</DATE>
  <EFFECTIVEDATE>${voucherTallyDate}</EFFECTIVEDATE>
  ${guidTag}
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <BUYERSORDERNO>${esc(inv.purchaseOrderRef || inv.buyersOrderNo || '')}</BUYERSORDERNO>
  <NARRATION>${esc(narration)}</NARRATION>
  ${/* bill-to / ship-to stripped pending confirmed-working test */ ''}
  <LEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
    <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
    <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    <BILLALLOCATIONS.LIST>
      <NAME>${esc(inv.invoiceNo)}</NAME>
      <BILLTYPE>New Ref</BILLTYPE>
      <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
      <AMOUNT>-${grandTotal.toFixed(2)}</AMOUNT>
    </BILLALLOCATIONS.LIST>
  </LEDGERENTRIES.LIST>
  ${cgst>0&&cgstLed ? `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(cgstLed)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>${cgst.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST>` : ''}
  ${sgst>0&&sgstLed ? `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(sgstLed)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>${sgst.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST>` : ''}
  ${igst>0&&igstLed ? `<LEDGERENTRIES.LIST><LEDGERNAME>${esc(igstLed)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER><AMOUNT>${igst.toFixed(2)}</AMOUNT></LEDGERENTRIES.LIST>` : ''}
  ${!useLegacyInventory ? `<LEDGERENTRIES.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE><ISPARTYLEDGER>No</ISPARTYLEDGER>
    <AMOUNT>${(totalTax>0 ? salesBase : grandTotal).toFixed(2)}</AMOUNT>
  </LEDGERENTRIES.LIST>` : ''}
  ${legacyInventoryXml}
</VOUCHER>`;
    }

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp   = await postXmlWithRetry(cfg, xml, connectorTimeout(cfg, 30000));
    const result = parseTallyResponse(resp, `Invoice ${inv.invoiceNo}`);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;

    await writeLog({
      syncId, type: 'Sales', direction: 'ERP → Tally',
      status: result.ok ? 'Success' : 'Failed',
      duration, error: result.error, records: 1,
    });

    if (result.ok) {
      await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { sort: { _id: 1 }, upsert: true });
      await Invoice.findByIdAndUpdate(invoiceId, { tallySync: true, tallySyncAt: new Date() });
      LOG(`Invoice ${inv.invoiceNo} pushed to Tally OK in ${duration}`);
    }

    return { ok: result.ok, invoiceNo: inv.invoiceNo, error: result.error, warning: result.warning, duration };

  } catch (err) {
    ERR('pushSingleInvoiceToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: 'Failed', duration, error: err.message, records: 0 });
    return { ok: false, error: err.message };
  }
}

// ─── PUSH: PAYMENT VOUCHERS (ERP → Tally) ───────────────────────────────────
// Pushes TallyVoucher records of type 'Payment' that were created in ERP.

export async function pushPaymentVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PAY-${Date.now()}`;
  LOG('=== pushPaymentVouchersToTally START ===');
  try {
    const payments = await TallyVoucher.find({
      voucherType: 'Payment', source: 'ERP', tallyGuid: { $exists:false },
    }).lean();

    if (!payments.length) {
      await writeLog({ syncId, type:'Payment', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    const vouchersXml = payments.map(pmt => {
      const date = tallyDate(pmt.voucherDate) || tallyDate(new Date());
      const ledgersXml = (pmt.ledgerEntries||[]).map(e => `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>${e.isDeemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
  <AMOUNT>${e.isDeemed ? '' : '-'}${Math.abs(e.amount||0)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`).join('');

      return `
<VOUCHER VCHTYPE="Payment" ACTION="Create">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Payment</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(pmt.voucherNumber||'')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(pmt.partyName||'')}</PARTYLEDGERNAME>
  <NARRATION>${esc(pmt.narration||'Payment')}</NARRATION>
  ${ledgersXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postXmlWithRetry(cfg, xml, connectorTimeout(cfg, 25000));
    const result  = parseTallyResponse(resp, 'Payment Vouchers');
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Payment', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records:payments.length, triggeredBy });
    return { ok:result.ok, records:payments.length, error:result.error };
  } catch (err) {
    ERR('pushPaymentVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Payment', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PUSH: RECEIPT VOUCHERS (ERP → Tally) ────────────────────────────────────

export async function pushReceiptVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-REC-${Date.now()}`;
  LOG('=== pushReceiptVouchersToTally START ===');
  try {
    const receipts = await TallyVoucher.find({
      voucherType: 'Receipt', source: 'ERP', tallyGuid: { $exists:false },
    }).lean();

    if (!receipts.length) {
      await writeLog({ syncId, type:'Receipt', direction:'ERP → Tally', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }

    const vouchersXml = receipts.map(rec => {
      const date = tallyDate(rec.voucherDate) || tallyDate(new Date());
      const ledgersXml = (rec.ledgerEntries||[]).map(e => `
<ALLLEDGERENTRIES.LIST>
  <LEDGERNAME>${esc(e.ledgerName)}</LEDGERNAME>
  <ISDEEMEDPOSITIVE>${e.isDeemed ? 'Yes' : 'No'}</ISDEEMEDPOSITIVE>
  <AMOUNT>${e.isDeemed ? '' : '-'}${Math.abs(e.amount||0)}</AMOUNT>
</ALLLEDGERENTRIES.LIST>`).join('');
      return `
<VOUCHER VCHTYPE="Receipt" ACTION="Create">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Receipt</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(rec.voucherNumber||'')}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(rec.partyName||'')}</PARTYLEDGERNAME>
  <NARRATION>${esc(rec.narration||'Receipt')}</NARRATION>
  ${ledgersXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>${staticVars(cfg)}</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${vouchersXml}</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;

    const resp    = await postXmlWithRetry(cfg, xml, connectorTimeout(cfg, 25000));
    const result  = parseTallyResponse(resp, 'Receipt Vouchers');
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Receipt', direction:'ERP → Tally', status:result.ok?'Success':'Failed', duration, error:result.error, records:receipts.length, triggeredBy });
    return { ok:result.ok, records:receipts.length, error:result.error };
  } catch (err) {
    ERR('pushReceiptVouchersToTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Receipt', direction:'ERP → Tally', status:'Failed', duration, error:err.message, records:0, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: STOCK ITEMS (Tally → ERP) ─────────────────────────────────────────
// Stores GUID to prevent duplicates on future syncs.

export async function pullItemsFromTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-ITEMS-${Date.now()}`;
  LOG('=== pullItemsFromTally START ===');
  try {
    // Helper to build dynamic TDL collection XML (uses type, no hardcoded names)
    const buildDynamicCollectionXml = (tallyType, collectionName) => {
      const company = (cfg.companyName || '').trim();
      const companyTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
      return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${collectionName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${companyTag}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${collectionName}">
            <TYPE>${tallyType}</TYPE>
            <FETCH>*</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
    };
    // Use dynamic TDL collection first, avoid hardcoded report names
    let resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('StockItem', 'DynamicInventory'), connectorTimeout(cfg, 60000));
    if (!resp || !resp.includes('<STOCKITEM')) {
      LOG('Dynamic TDL failed, trying fallback dynamic collection...');
      resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('StockItem', 'StockItems'), connectorTimeout(cfg, 60000));
    }
    if (!resp || !resp.includes('<STOCKITEM')) {
      await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<STOCKITEM([^>]*)>([\s\S]*?)<\/STOCKITEM>/gi)];
    const ops = [];
    for (const m of matches) {
      const attrs = m[1];
      const block = m[2];
      
      // Extract name from various places
      let name = '';
      const nameAttrMatch = attrs.match(/NAME="([^"]*)"/i);
      if (nameAttrMatch) name = nameAttrMatch[1].trim();
      
      if (!name) {
        // Try LANGUAGENAME.LIST -> NAME.LIST -> NAME
        const langNameMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
        if (langNameMatch) name = langNameMatch[1].trim();
      }
      
      if (!name) continue;
      
      const guid = extractGuid(block);
      const alterId = extractAlterId(block);
      const hsn     = (block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i)?.[1]||'').trim();
      const gst     = parseFloat(block.match(/<GSTRATE>(.*?)<\/GSTRATE>/i)?.[1])||0;
      const unit    = (block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i)?.[1]||'Nos').trim();
      const cost    = parseFloat(block.match(/<STANDARDCOST>(.*?)<\/STANDARDCOST>/i)?.[1])||0;
      const uMap = {Nos:'units',Kg:'kg',Ltr:'liter',Mtr:'meter',Box:'box',Pcs:'piece'};
      const cleanGuid = guid ? guid.replace(/[^A-Z0-9]/gi, '') : null;
      const sku = cleanGuid ? `TALLY-${cleanGuid}` : name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,30);
      const itemId = cleanGuid ? `TALLY-${cleanGuid}` : `TALLY-${sku}-${Date.now().toString(36)}-${Math.random().toString(36).substring(2, 8)}`;
      ops.push({ updateOne:{
        filter: guid ? { tallyGuid: guid } : { name },
        update:{
          $set:{ itemId, sku, hsn, gst, unit:uMap[unit]||'units', costPrice:cost, unitPrice:cost,
                 tallySynced:true, lastTallySync:new Date(),
                 dataSource:'Tally',  // mark as imported from Tally — never export back
                 ...(guid ? { tallyGuid:guid } : {}),
                 ...(alterId ? { tallyAlterId:alterId } : {}) },
          $setOnInsert:{ name, sellingPrice:cost, isActive:true },
        },
        upsert:true,
      }});
    }
    if (ops.length) await ItemMaster.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    LOG(`Pulled ${ops.length} items in ${duration}`);
    return { ok:true, records:ops.length };
  } catch (err) {
    ERR('pullItemsFromTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: LEDGERS (Tally → ERP) ─────────────────────────────────────────────
// Upserts Vendors from Sundry Creditors and Clients from Sundry Debtors using GUID.

export async function pullLedgersFromTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-LEDGER-${Date.now()}`;
  LOG('=== pullLedgersFromTally START ===');
  try {
    // Helper to build dynamic TDL collection XML (uses type, no hardcoded names)
    const buildDynamicCollectionXml = (tallyType, collectionName) => {
      const company = (cfg.companyName || '').trim();
      const companyTag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
      return `<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Collection</TYPE>
    <ID>${collectionName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        ${companyTag}
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
      <TDL>
        <TDLMESSAGE>
          <COLLECTION NAME="${collectionName}">
            <TYPE>${tallyType}</TYPE>
            <FETCH>*</FETCH>
          </COLLECTION>
        </TDLMESSAGE>
      </TDL>
    </DESC>
  </BODY>
</ENVELOPE>`;
    };
    // Use dynamic TDL collection first, avoid hardcoded report names
    let resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('Ledger', 'DynamicLedger'), connectorTimeout(cfg, 60000));
    if (!resp || !resp.includes('<LEDGER')) {
      LOG('Dynamic TDL failed, trying fallback dynamic collection...');
      resp = await postXmlWithRetry(cfg, buildDynamicCollectionXml('Ledger', 'Ledgers'), connectorTimeout(cfg, 60000));
    }
    if (!resp || !resp.includes('<LEDGER')) {
      await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<LEDGER([^>]*)>([\s\S]*?)<\/LEDGER>/gi)];
    const ledgerOps = [], vendorOps = [], clientOps = [];

    for (const m of matches) {
      const attrs = m[1];
      const block = m[2] || '';
      
      // Extract name from various places
      let name = '';
      const nameAttrMatch = attrs.match(/NAME="([^"]*)"/i);
      if (nameAttrMatch) name = nameAttrMatch[1].trim();
      
      if (!name) {
        // Try LANGUAGENAME.LIST -> NAME.LIST -> NAME
        const langNameMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
        if (langNameMatch) name = langNameMatch[1].trim();
      }
      if (!name) {
        // Try LEDGSTNAME
        const gstNameMatch = block.match(/<LEDGSTNAME>([\s\S]*?)<\/LEDGSTNAME>/i);
        if (gstNameMatch) name = gstNameMatch[1].trim();
      }
      if (!name) {
        // Try MAILINGNAME
        const mailingNameMatch = block.match(/<MAILINGNAME>([\s\S]*?)<\/MAILINGNAME>/i);
        if (mailingNameMatch) name = mailingNameMatch[1].trim();
      }
      
      if (!name) continue;
      
      const guid = extractGuid(block);
      if (!guid) {
        LOG('Skipping ledger without GUID:', name);
        continue;
      }
      const alterId = extractAlterId(block);
      const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1]||'').trim();
      if (!parent.toLowerCase().includes('sundry')) continue;

      const gstNumber      = (block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i)?.[1]||'N/A').trim();
      const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i)?.[1])||0;
      const email          = (block.match(/<EMAIL>(.*?)<\/EMAIL>/i)?.[1]||'').trim();
      const phone          = (block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i)?.[1]||'').trim();
      const isCreditor     = parent.toLowerCase().includes('creditor');
      const ledgerGroup    = isCreditor ? 'Sundry Creditors' : 'Sundry Debtors';
      const ledgerCode     = `TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`;

      // Upsert AccountsLedger (primary record)
      const ledgerFilter = { tallyGuid: guid };
      ledgerOps.push({ updateOne:{
        filter: ledgerFilter,
        update:{
          $set:{ tallyGuid: guid, tallyAlterId: alterId, ledgerGroup, gstNumber, openingBalance, email, phone,
                 syncedWithTally:true, lastTallySync:new Date(),
                 dataSource:'Tally' },  // mark as imported from Tally — never export back
          $setOnInsert:{ ledgerCode, ledgerName:name, contactPerson:name, panNumber:'N/A', isActive:true },
        },
        upsert:true,
      }});

      // Also upsert Vendor or Client model for full ERP integration
      if (isCreditor) {
        const vFilter = { tallyGuid: guid };
        const safeEmail = email || `${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`;
        vendorOps.push({ updateOne:{
          filter: vFilter,
          update:{
            $set:{ 
              tallyGuid: guid,
              tallyAlterId: alterId,
              email: safeEmail, 
              phone: phone || '0000000000', 
              gstNumber: gstNumber || 'N/A',
              address: 'Imported from Tally',
              contactPerson: name,
              tallySynced:true, lastTallySync:new Date(),
              dataSource:'Tally'  // mark as imported from Tally — never export back
            },
            $setOnInsert:{
              vendorId: `VND-TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`,
              companyName: name,
              category:'General',
              status:'Active',
            },
          },
          upsert:true,
        }});
      } else {
        const cFilter = { tallyGuid: guid };
        const safeEmail = email || `${name.replace(/\s+/g,'').toLowerCase()}@tally.sync`;
        clientOps.push({ updateOne:{
          filter: cFilter,
          update:{
            $set:{ 
              tallyGuid: guid,
              tallyAlterId: alterId,
              email: safeEmail, 
              phone: phone || '0000000000', 
              gstNumber: gstNumber || 'N/A',
              address: 'Imported from Tally',
              contact: name,
              tallySynced:true, lastTallySync:new Date(),
              dataSource:'Tally'  // mark as imported from Tally — never export back
            },
            $setOnInsert:{
              clientId: `CLT-TALLY-${guid.replace(/[^A-Z0-9]/gi, '')}`,
              name,
              category:'Trading',
              status:'Active',
            },
          },
          upsert:true,
        }});
      }
    }

    const [lr, vr, cr] = await Promise.all([
      ledgerOps.length ? AccountsLedger.bulkWrite(ledgerOps, { ordered:false }) : Promise.resolve(null),
      vendorOps.length ? Vendor.bulkWrite(vendorOps, { ordered:false }) : Promise.resolve(null),
      clientOps.length ? Client.bulkWrite(clientOps, { ordered:false }) : Promise.resolve(null),
    ]);
    const records = ledgerOps.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Success', duration, records, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    LOG(`Pulled ${records} ledgers (${vendorOps.length} vendors, ${clientOps.length} clients) in ${duration}`);
    return { ok:true, records };
  } catch (err) {
    ERR('pullLedgersFromTally:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: VOUCHERS (Sales/Purchase) from Tally ───────────────────────────────

export async function pullVouchersFromTally(cfg, voucherType, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-${voucherType.toUpperCase()}-${Date.now()}`;
  const logType = voucherType === 'Purchase' ? 'Purchase' : 'Sales';
  LOG(`=== pullVouchersFromTally (${voucherType}) START ===`);
  try {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>
${exportVars(`<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>`)}</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, connectorTimeout(cfg, 30000));
    if (!resp || !resp.includes('<VOUCHER') || resp.includes('<TALLYREQUEST>Import Data')) {
      await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const vMatches = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    const ops = [];
    for (const m of vMatches) {
      const block      = m[1];
      const guid       = extractGuid(block);
      if (!guid) continue;
      const alterId    = extractAlterId(block);
      const invoiceNo  = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
      const partyName  = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'Unknown').trim();
      const rawDate    = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
      const grandTotal = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
      const invDate    = rawDate.length===8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();
      ops.push({ updateOne:{
        filter: { tallyGuid: guid },
        update:{
          $set:{ tallyGuid: guid, tallyAlterId: alterId, partyName, grandTotal, source:'Tally' },
          $setOnInsert:{ invoiceNo, partyName, invoiceDate:invDate, grandTotal, source:'Tally', status:'Sent', invoiceType:'single', items:[] },
        },
        upsert:true,
      }});
    }
    if (ops.length) await Invoice.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    return { ok:true, records:ops.length };
  } catch (err) {
    ERR(`pullVouchersFromTally(${voucherType}):`, err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── PULL: PAYMENT & RECEIPT VOUCHERS (Tally → ERP) ─────────────────────────
// Stores into TallyVoucher model with GUID deduplication.

export async function pullPaymentReceiptFromTally(cfg, voucherType, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-${voucherType.toUpperCase()}-${Date.now()}`;
  LOG(`=== pullPaymentReceiptFromTally (${voucherType}) START ===`);
  try {
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>
${exportVars(`<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>`)}</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, connectorTimeout(cfg, 30000));
    if (!resp || !resp.includes('<VOUCHER')) {
      await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const vMatches = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
    const ops = [];
    for (const m of vMatches) {
      const block       = m[1];
      const guid        = extractGuid(block);
      if (!guid) continue;
      const alterId     = extractAlterId(block);
      const voucherNo   = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
      const partyName   = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'').trim();
      const rawDate     = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
      const narration   = (block.match(/<NARRATION>(.*?)<\/NARRATION>/i)?.[1]||'').trim();
      const vDate       = rawDate.length===8 ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`) : new Date();

      // Parse ledger entries
      const ledgerEntries = [];
      for (const le of block.matchAll(/<ALLLEDGERENTRIES\.LIST>([\s\S]*?)<\/ALLLEDGERENTRIES\.LIST>/gi)) {
        const lb = le[1];
        const lName   = (lb.match(/<LEDGERNAME>(.*?)<\/LEDGERNAME>/i)?.[1]||'').trim();
        const lAmt    = parseFloat(lb.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0;
        const isDeemed = (lb.match(/<ISDEEMEDPOSITIVE>(.*?)<\/ISDEEMEDPOSITIVE>/i)?.[1]||'No').trim() === 'Yes';
        if (lName) ledgerEntries.push({ ledgerName:lName, amount:lAmt, isDeemed });
      }

      // Parse inventory entries (ALLINVENTORYENTRIES.LIST for Sales/Purchase)
      const inventoryEntries = [];
      const invPat = /<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>|<INVENTORYENTRIES\.LIST>([\s\S]*?)<\/INVENTORYENTRIES\.LIST>/gi;
      for (const inv of block.matchAll(invPat)) {
        const ib = inv[1] || inv[2];
        const sn = (ib.match(/<STOCKITEMNAME>(.*?)<\/STOCKITEMNAME>/i)?.[1]||'').trim();
        if (!sn) continue;
        const rawQty  = (ib.match(/<BILLEDQTY>(.*?)<\/BILLEDQTY>/i)?.[1] || ib.match(/<ACTUALQTY>(.*?)<\/ACTUALQTY>/i)?.[1] || '0').trim();
        const rawRate = (ib.match(/<RATE>(.*?)<\/RATE>/i)?.[1]||'0').trim();
        const qty  = parseFloat(rawQty.replace(/[^\d.-]/g,''))  || 0;
        const rate = parseFloat(rawRate.replace(/[^\d.-]/g,'')) || 0;
        const amt  = Math.abs(parseFloat(ib.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
        inventoryEntries.push({ stockItemName: sn, qty, rate, amount: amt });
      }

      // Compute amount: items+taxes → max ledger → fallback
      let amount = 0;
      if (inventoryEntries.length > 0) {
        const itemTotal = inventoryEntries.reduce((s,i) => s + i.amount, 0);
        const taxTotal  = ledgerEntries.reduce((s,l) => {
          const n = l.ledgerName.toLowerCase();
          return (n.includes('cgst')||n.includes('sgst')||n.includes('igst')||n.includes('gst')||n.includes('tax')||n.includes('round')) ? s + Math.abs(l.amount) : s;
        }, 0);
        amount = itemTotal + taxTotal;
      } else if (ledgerEntries.length > 0) {
        amount = Math.max(...ledgerEntries.map(l => Math.abs(l.amount)));
        if (!isFinite(amount)) amount = 0;
      }
      if (amount === 0) amount = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);

      ops.push({ updateOne:{
        filter: { tallyGuid: guid },
        update:{
          $set:{ tallyGuid: guid, tallyAlterId: alterId, voucherNumber: voucherNo, voucherType, partyName, partyLedgerName: partyName, amount, narration, voucherDate:vDate, ledgerEntries, inventoryEntries, source:'Tally', syncedAt:new Date() },
        },
        upsert:true,
      }});
    }
    if (ops.length) await TallyVoucher.bulkWrite(ops, { ordered:false });
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Success', duration, records:ops.length, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{sort:{_id:1},upsert:true});
    LOG(`Pulled ${ops.length} ${voucherType} vouchers in ${duration}`);
    return { ok:true, records:ops.length };
  } catch (err) {
    ERR(`pullPaymentReceiptFromTally(${voucherType}):`, err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:voucherType, direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── ORCHESTRATORS ────────────────────────────────────────────────────────────

function mergeResults(results) {
  const records = results.reduce((s,r)=>s+(r.records||0),0);
  const failed  = results.filter(r=>!r.ok);
  const ok      = failed.length === 0;
  const error   = failed.map(r=>r.error).filter(Boolean).join('; ') || undefined;
  return { ok, records, results, error };
}

/**
 * runFullSync — complete bi-directional sync:
 *   Phase 1 (ERP → Tally): Masters → Purchase Vouchers → Sales Vouchers → Payment → Receipt
 *   Phase 2 (Tally → ERP): Stock Items → Ledgers → Sales Vouchers → Purchase Vouchers → Payments → Receipts
 */
export async function runFullSync(triggeredBy) {
  LOG('========== runFullSync START ==========');
  const cfg   = await getConfig();
  const check = await checkTallyReachable(cfg);
  if (!check.reachable) {
    ERR('Tally not reachable:', check.error);
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{sort:{_id:1},upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{sort:{_id:1},upsert:true});

  const direction = cfg.syncDirection || 'Bi-directional';
  const prefs     = cfg.syncPrefs || {};
  const results   = [];

  // ── ERP → Tally ────────────────────────────────────────────────────────────
  if (direction !== 'Tally → ERP') {
    // Always push masters first — party ledgers and stock items must exist in Tally
    // before vouchers can reference them, otherwise Tally throws EXCEPTIONS for every
    // voucher. Masters use ACTION="Create" so Tally silently skips existing ones.
    results.push(await pushMastersToTally(cfg, triggeredBy));
    if (prefs.purchaseVouchers !== false) results.push(await pushPurchaseVouchersToTally(cfg, triggeredBy));
    if (prefs.salesVouchers !== false)    results.push(await pushSalesVouchersToTally(cfg, triggeredBy));
    if (prefs.paymentVouchers !== false)  results.push(await pushPaymentVouchersToTally(cfg, triggeredBy));
    if (prefs.receiptVouchers !== false)  results.push(await pushReceiptVouchersToTally(cfg, triggeredBy));
  }

  // ── Tally → ERP ────────────────────────────────────────────────────────────
  if (direction !== 'ERP → Tally') {
    if (prefs.masterData !== false) {
      results.push(await pullItemsFromTally(cfg, triggeredBy));
      results.push(await pullLedgersFromTally(cfg, triggeredBy));
    }
    if (prefs.purchaseVouchers !== false) results.push(await pullVouchersFromTally(cfg,'Purchase',triggeredBy));
    if (prefs.salesVouchers !== false)    results.push(await pullVouchersFromTally(cfg,'Sales',triggeredBy));
    if (prefs.paymentVouchers !== false)  results.push(await pullPaymentReceiptFromTally(cfg,'Payment',triggeredBy));
    if (prefs.receiptVouchers !== false)  results.push(await pullPaymentReceiptFromTally(cfg,'Receipt',triggeredBy));
  }

  const totalRecords = results.reduce((s,r)=>s+(r.records||0),0);
  const failed       = results.filter(r=>!r.ok);
  const ok           = failed.length === 0;
  const error        = failed.length > 0 ? failed.map(r=>r.error).filter(Boolean).join('; ') : undefined;
  LOG(`========== runFullSync END — ok:${ok} records:${totalRecords} errors:${error||'none'} ==========`);
  return { ok, records:totalRecords, results, error };
}

/**
 * runTargetedSync — for individual sync buttons / manual triggers
 */
export async function runTargetedSync(type, triggeredBy) {
  LOG(`runTargetedSync type="${type}"`);
  const cfg   = await getConfig();
  const check = await checkTallyReachable(cfg);
  if (!check.reachable) {
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{sort:{_id:1},upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{sort:{_id:1},upsert:true});

  const direction = cfg.syncDirection || 'Bi-directional';
  const pushOnly  = direction === 'ERP → Tally';
  const pullOnly  = direction === 'Tally → ERP';

  switch (type) {
    case 'master':
    case 'Item Master':
    case 'Items':
    case 'Ledger':
    case 'Ledgers': {
      // Master export to Tally is disabled — only pull from Tally is allowed.
      const results = [];
      if (!pushOnly) {
        results.push(await pullItemsFromTally(cfg, triggeredBy));
        results.push(await pullLedgersFromTally(cfg, triggeredBy));
      }
      return mergeResults(results);
    }
    case 'transaction':
    case 'Purchase':
    case 'Purchase Vouchers': {
      const results = [];
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));  // ensure ledgers/items exist first
        results.push(await pushPurchaseVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullVouchersFromTally(cfg,'Purchase',triggeredBy));
      return mergeResults(results);
    }
    case 'Sales':
    case 'Sales Vouchers': {
      const results = [];
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));  // ensure ledgers/items exist first
        results.push(await pushSalesVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullVouchersFromTally(cfg,'Sales',triggeredBy));
      return mergeResults(results);
    }
    case 'Payment':
    case 'Payment Vouchers': {
      const results = [];
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));  // ensure ledgers/items exist first
        results.push(await pushPaymentVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullPaymentReceiptFromTally(cfg,'Payment',triggeredBy));
      return mergeResults(results);
    }
    case 'Receipt':
    case 'Receipt Vouchers': {
      const results = [];
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));  // ensure ledgers/items exist first
        results.push(await pushReceiptVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullPaymentReceiptFromTally(cfg,'Receipt',triggeredBy));
      return mergeResults(results);
    }
    case 'Full':
    default:
      return runFullSync(triggeredBy);
  }
}
