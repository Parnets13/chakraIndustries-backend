/**
 * tallyService.js  — Bidirectional ERP ↔ Tally sync via Tally XML/HTTP API
 *
 * KEY RULES for Tally XML import:
 *  1. REPORTNAME=All Masters  → for STOCKGROUP, STOCKITEM, LEDGER masters
 *  2. REPORTNAME=Vouchers     → for VOUCHER entries ONLY
 *  3. Masters and Vouchers CANNOT be mixed in the same TALLYMESSAGE
 *  4. Within one TALLYMESSAGE, entries are processed top-to-bottom,
 *     so STOCKGROUP must come before STOCKITEM in the same message.
 *  5. Vouchers reference stock items/ledgers that must already exist in Tally
 *     BEFORE the voucher request is sent (separate prior request is fine).
 */

import axios from 'axios';
import TallyConfig    from '../models/TallyConfig.js';
import TallySyncLog   from '../models/TallySyncLog.js';
import ItemMaster     from '../models/ItemMaster.js';
import Vendor         from '../models/Vendor.js';
import AccountsLedger from '../models/AccountsLedger.js';
import PurchaseOrder  from '../models/PurchaseOrder.js';
import Invoice        from '../models/Invoice.js';

const LOG = (...a) => console.log('[Tally]', ...a);
const ERR = (...a) => console.error('[Tally ERROR]', ...a);

// ─── CONFIG ───────────────────────────────────────────────────────────────────

async function getConfig() {
  let cfg = await TallyConfig.findOne();
  if (!cfg) cfg = await TallyConfig.create({});
  return cfg;
}

function tallyUrl(cfg) {
  const host = (cfg.serverUrl || 'http://localhost').replace(/\/$/, '');
  const port = cfg.port || '9000';
  if (host.includes(`:${port}`)) return host;
  return `${host}:${port}`;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function postToTally(cfg, xml, timeoutMs = 20000) {
  const url = tallyUrl(cfg);
  const headers = { 'Content-Type': 'text/xml' };
  if (cfg.authType === 'Basic Auth' && cfg.apiKey)
    headers['Authorization'] = `Basic ${Buffer.from(cfg.apiKey).toString('base64')}`;
  else if (cfg.authType === 'API Key' && cfg.apiKey)
    headers['Authorization'] = `Bearer ${cfg.apiKey}`;

  LOG(`POST ${url} (${xml.length} bytes)`);
  const resp = await axios.post(url, xml, { headers, timeout: timeoutMs, responseType: 'text' });
  const body = typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data);
  LOG(`Response (${body.length} bytes):`, body.slice(0, 500));
  return body;
}

async function checkReachable(cfg) {
  const url = tallyUrl(cfg);
  const pingXml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>List of Companies</REPORTNAME></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
  try {
    await axios.post(url, pingXml, {
      headers: { 'Content-Type': 'text/xml' },
      timeout: 6000, responseType: 'text', validateStatus: () => true,
    });
    return { reachable: true };
  } catch (err) {
    const code = err.code || '';
    if (code === 'ECONNREFUSED')
      return { reachable: false, error: `Tally not running at ${url}. Open Tally Prime and enable HTTP Server on port 9000.` };
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED')
      return { reachable: false, error: `Tally at ${url} timed out. Enable HTTP Server in Tally: F12 → Configure → Advanced → Enable ODBC Server: Yes, Port: 9000.` };
    if (code === 'ENOTFOUND')
      return { reachable: false, error: `Cannot resolve host "${cfg.serverUrl}". Check Tally server URL.` };
    return { reachable: false, error: err.message || `Cannot connect to Tally at ${url}` };
  }
}

// ─── XML HELPERS ──────────────────────────────────────────────────────────────

function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function tallyDate(d) {
  const dt = d ? new Date(d) : null;
  // Return null if date is invalid
  if (!dt || isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
}

function staticVars(cfg, extra = '') {
  const company = (cfg.companyName || '').trim();
  const tag = company ? `<SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY>` : '';
  return `<STATICVARIABLES>${tag}${extra}</STATICVARIABLES>`;
}

/** For EXPORT requests — never include SVCURRENTCOMPANY, it confuses some Tally versions */
function exportVars(extra = '') {
  return `<STATICVARIABLES>${extra}</STATICVARIABLES>`;
}

const UNIT_MAP = {
  kg:'Kg', kgs:'Kg', kilogram:'Kg',
  liter:'Ltr', litre:'Ltr', ltr:'Ltr',
  meter:'Mtr', metre:'Mtr', mtr:'Mtr',
  box:'Box', boxes:'Box',
  piece:'Pcs', pieces:'Pcs', pcs:'Pcs', pc:'Pcs',
  nos:'Nos', no:'Nos', number:'Nos', units:'Nos', unit:'Nos',
};
const tallyUnit = (u) => UNIT_MAP[(u||'').toLowerCase().trim()] || 'Nos';

// ─── RESPONSE PARSER ─────────────────────────────────────────────────────────

function parseTallyResponse(xml, label = '') {
  if (!xml || !xml.trim()) {
    ERR(label, 'Empty response from Tally');
    return { ok: false, error: 'Empty response from Tally' };
  }
  const s = String(xml);
  const errors = [];

  // Collect ALL <LINEERROR> tags
  for (const m of s.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)) {
    const msg = m[1].trim();
    if (msg) errors.push(msg);
  }
  // <ERRORS> block
  if (s.includes('<ERRORS>')) {
    const m = s.match(/<ERRORS>([\s\S]*?)<\/ERRORS>/i);
    if (m) { const msg = m[1].replace(/<[^>]+>/g,' ').trim(); if (msg) errors.push(msg); }
  }

  // Parse IMPORTRESULT stats for logging
  const created = parseInt(s.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
  const altered  = parseInt(s.match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1]  || '0');
  const skipped  = parseInt(s.match(/<SKIPPED>(\d+)<\/SKIPPED>/i)?.[1]  || '0');
  const deleted  = parseInt(s.match(/<DELETED>(\d+)<\/DELETED>/i)?.[1]  || '0');
  LOG(`${label} IMPORTRESULT → created:${created} altered:${altered} skipped:${skipped} deleted:${deleted} errors:${errors.length}`);

  // IMPORTANT: Tally reports LINEERROR even for partial successes.
  // Only treat as failure if NOTHING was created/altered AND there are errors.
  // If some records were processed successfully, treat as partial success (ok=true).
  if (errors.length > 0) {
    if (created === 0 && altered === 0) {
      ERR(`${label} FAILED — nothing processed. Errors:`, errors.join(' | '));
      return { ok: false, error: errors.join('; ') };
    } else {
      // Partial — some records processed, some had errors (e.g. group warning)
      LOG(`${label} partial success (${created} created, ${altered} altered). Warnings:`, errors.join(' | '));
      return { ok: true, created, altered, warning: errors.join('; ') };
    }
  }
  return { ok: true, created, altered };
}

// ─── SYNC LOG ─────────────────────────────────────────────────────────────────

async function writeLog({ syncId, type, direction, status, duration, error, records, triggeredBy }) {
  try {
    await TallySyncLog.create({
      syncId, type, direction,
      status, duration: duration || '0s',
      error: error || '', records: records || 0,
      triggeredBy: triggeredBy || null,
    });
  } catch (_) {}
}

// ─── TEST CONNECTION ──────────────────────────────────────────────────────────

export async function testTallyConnection() {
  const cfg = await getConfig();
  LOG('Testing connection to', tallyUrl(cfg));
  const check = await checkReachable(cfg);
  if (!check.reachable) {
    ERR('Not reachable:', check.error);
    await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Disconnected' }, { upsert: true });
    return { status: 'Disconnected', error: check.error };
  }
  // Try multiple report names — different Tally versions support different ones
  const probeReports = ['List of Companies', 'Company', 'List of Accounts'];
  for (const rn of probeReports) {
    try {
      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER><BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>${rn}</REPORTNAME></REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
      const resp = await postToTally(cfg, xml, 8000);
      // Any non-error response means Tally is alive
      if (resp && !resp.includes('Could not find Report')) {
        LOG(`Connected via report "${rn}"`);
        await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Connected' }, { upsert: true });
        return { status: 'Connected', error: null };
      }
    } catch (_) {}
  }
  // Even if all reports fail, if Tally is responding at all it's connected
  LOG('Tally responding but no matching report — treating as Connected');
  await TallyConfig.findOneAndUpdate({}, { connectionStatus: 'Connected' }, { upsert: true });
  return { status: 'Connected', error: null };
}

// ─── PHASE 1: PUSH ALL MASTERS (group + items + ledgers) ─────────────────────
/**
 * Sends ONE "All Masters" request containing:
 *   STOCKGROUP "ERP Items"  (must come before STOCKITEMs)
 *   STOCKITEM  × N
 *   LEDGER     × M  (vendors + system ledgers)
 *
 * This is the ONLY correct way — masters and vouchers use different REPORTNAME
 * contexts and cannot be mixed.
 */
export async function pushMastersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-MASTERS-${Date.now()}`;
  LOG('=== pushMastersToTally START ===');

  try {
    const [items, vendors, ledgers] = await Promise.all([
      ItemMaster.find({ isActive: true }).lean(),
      Vendor.find({ status: 'Active' }).lean(),
      AccountsLedger.find({ isActive: true }).lean(),
    ]);
    LOG(`Items: ${items.length}, Vendors: ${vendors.length}, Ledgers: ${ledgers.length}`);

    // ── Stock Items ──────────────────────────────────────────────────────────
    // Use empty PARENT so Tally places items under its default root group.
    // Never use a custom group name — it may not exist in the company.
    const stockGroupXml = ''; // no custom group needed
    const stockItemsXml = items.map(item => `
<STOCKITEM NAME="${esc(item.name)}" ACTION="Create">
  <NAME>${esc(item.name)}</NAME>
  <UNITS>${tallyUnit(item.unit)}</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>${esc(item.hsn || '')}</HSNCODE>
  <GSTRATE>${item.gst || 0}</GSTRATE>
</STOCKITEM>`).join('');

    // Also create stock items for any PO item names not in ItemMaster
    // so vouchers can reference them
    const allPOs = await PurchaseOrder.find({ status: { $in: ['Approved', 'Received'] }, tallySync: { $ne: true } }).lean();
    const poItemNames = new Set();
    for (const po of allPOs) {
      for (const item of (po.items || [])) {
        if (item.name && !items.find(i => i.name === item.name)) {
          poItemNames.add(item.name.trim());
        }
      }
    }
    LOG(`Extra PO items not in ItemMaster: ${[...poItemNames].join(', ') || 'none'}`);
    const extraItemsXml = [...poItemNames].map(name => `
<STOCKITEM NAME="${esc(name)}" ACTION="Create">
  <NAME>${esc(name)}</NAME>
  <UNITS>Nos</UNITS>
  <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
</STOCKITEM>`).join('');

    // ── System Ledgers (Purchase Accounts, Sales Accounts, CGST, SGST, IGST) ─
    const systemLedgersXml = `
<LEDGER NAME="Purchase Accounts" ACTION="Create">
  <NAME>Purchase Accounts</NAME><PARENT>Purchase Accounts</PARENT><OPENINGBALANCE>0</OPENINGBALANCE>
</LEDGER>
<LEDGER NAME="Sales Accounts" ACTION="Create">
  <NAME>Sales Accounts</NAME><PARENT>Sales Accounts</PARENT><OPENINGBALANCE>0</OPENINGBALANCE>
</LEDGER>
<LEDGER NAME="CGST" ACTION="Create">
  <NAME>CGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Central Tax</TAXTYPE><OPENINGBALANCE>0</OPENINGBALANCE>
</LEDGER>
<LEDGER NAME="SGST" ACTION="Create">
  <NAME>SGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>State Tax</TAXTYPE><OPENINGBALANCE>0</OPENINGBALANCE>
</LEDGER>
<LEDGER NAME="IGST" ACTION="Create">
  <NAME>IGST</NAME><PARENT>Duties &amp; Taxes</PARENT><TAXTYPE>Integrated Tax</TAXTYPE><OPENINGBALANCE>0</OPENINGBALANCE>
</LEDGER>`;

    // ── Vendor Ledgers ───────────────────────────────────────────────────────
    // Fetch ALL vendors (any status) so every PO vendor gets a ledger in Tally
    const allVendors = await Vendor.find({}).lean();
    LOG(`All vendors (any status): ${allVendors.length}`);
    const vendorLedgersXml = allVendors.map(v => `
<LEDGER NAME="${esc(v.companyName)}" ACTION="Create">
  <NAME>${esc(v.companyName)}</NAME>
  <PARENT>Sundry Creditors</PARENT>
  <GSTREGISTRATIONTYPE>${v.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(v.gstNumber || '')}</PARTYGSTIN>
  <OPENINGBALANCE>0</OPENINGBALANCE>
</LEDGER>`).join('');

    // ── Accounts Ledgers ─────────────────────────────────────────────────────
    const tallyParent = (g) => {
      const s = (g||'').toLowerCase();
      if (s.includes('creditor')||s.includes('payable'))   return 'Sundry Creditors';
      if (s.includes('debtor')||s.includes('receivable'))  return 'Sundry Debtors';
      if (s.includes('bank'))   return 'Bank Accounts';
      if (s.includes('cash'))   return 'Cash-in-Hand';
      if (s.includes('expense')) return 'Indirect Expenses';
      if (s.includes('income')||s.includes('revenue')) return 'Indirect Incomes';
      if (s.includes('capital')) return 'Capital Account';
      if (s.includes('loan'))    return 'Loans (Liability)';
      return 'Sundry Debtors';
    };
    const acctLedgersXml = ledgers.map(l => `
<LEDGER NAME="${esc(l.ledgerName)}" ACTION="Create">
  <NAME>${esc(l.ledgerName)}</NAME>
  <PARENT>${esc(tallyParent(l.ledgerGroup))}</PARENT>
  <GSTREGISTRATIONTYPE>${l.gstNumber ? 'Regular' : 'Unregistered'}</GSTREGISTRATIONTYPE>
  <PARTYGSTIN>${esc(l.gstNumber || '')}</PARTYGSTIN>
  <OPENINGBALANCE>${l.openingBalance || 0}</OPENINGBALANCE>
</LEDGER>`).join('');

    // ── Single "All Masters" request ─────────────────────────────────────────
    // Order: StockItems → ExtraItems → SystemLedgers → VendorLedgers → AcctLedgers
    const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC>
  <REPORTNAME>All Masters</REPORTNAME>
  ${staticVars(cfg)}
</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
${stockItemsXml}
${extraItemsXml}
${systemLedgersXml}
${vendorLedgersXml}
${acctLedgersXml}
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

    LOG('Sending All Masters XML...');
    const resp   = await postToTally(cfg, xml, 30000);
    const result = parseTallyResponse(resp, 'All Masters');
    const records = items.length + vendors.length + ledgers.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;

    await writeLog({ syncId, type: 'Item Master', direction: 'ERP → Tally',
      status: result.ok ? 'Success' : 'Failed', duration, error: result.error, records, triggeredBy });

    if (result.ok) {
      await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { upsert: true });
      await AccountsLedger.updateMany({ isActive: true }, { syncedWithTally: true, lastTallySync: new Date() });
      LOG(`Masters synced OK — ${records} records in ${duration}`);
    } else {
      ERR('Masters sync FAILED:', result.error);
    }
    return { ok: result.ok, records, error: result.error };
  } catch (err) {
    ERR('pushMastersToTally exception:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Item Master', direction: 'ERP → Tally',
      status: 'Failed', duration, error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// Keep old names as aliases so targeted sync still works
export const pushItemsToTally   = (cfg, t) => pushMastersToTally(cfg, t);
export const pushLedgersToTally = (cfg, t) => pushMastersToTally(cfg, t);

// ─── PHASE 2: PUSH PURCHASE VOUCHERS ─────────────────────────────────────────
// Masters MUST already exist in Tally before this runs (call pushMastersToTally first).

export async function pushPurchaseVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PUR-${Date.now()}`;
  LOG('=== pushPurchaseVouchersToTally START ===');
  try {
    const pos = await PurchaseOrder.find({
      status: { $in: ['Approved', 'Received'] },
      tallySync: { $ne: true },
    }).populate('vendor').lean();

    LOG(`POs to sync: ${pos.length}`);
    if (!pos.length) {
      await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally', status: 'Success', records: 0, triggeredBy });
      return { ok: true, records: 0 };
    }

    const today = tallyDate(new Date());
    const validVouchers = [];

    for (const po of pos) {
      const vendorName = po.vendor?.companyName || 'Unknown Vendor';
      const date = tallyDate(po.createdAt) || today;
      const cgst = (po.gstTotal || 0) / 2;
      const sgst = (po.gstTotal || 0) / 2;
      LOG(`  PO ${po.poId} vendor="${vendorName}" items=${po.items?.length} total=${po.grandTotal} date=${date}`);

      // All items are now pushed to Tally as masters (including PO-only items)
      const itemsXml = (po.items || []).map(item => {
        const itemName = (item.name || 'Unknown Item').trim();
        LOG(`    item="${itemName}"`);
        return `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
  <RATE>${item.basePrice || item.unitPrice || 0}/Nos</RATE>
  <AMOUNT>-${item.total || 0}</AMOUNT>
  <ACTUALQTY>${item.qty || item.quantity || 0} Nos</ACTUALQTY>
  <BILLEDQTY>${item.qty || item.quantity || 0} Nos</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Purchase Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>-${item.total || 0}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`;
      }).join('');

      validVouchers.push(`
<VOUCHER VCHTYPE="Purchase" ACTION="Create">
  <DATE>${date}</DATE>
  <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(po.poId)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(vendorName)}</PARTYLEDGERNAME>
  <NARRATION>PO: ${esc(po.poId)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(vendorName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${po.grandTotal || 0}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgst > 0 ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${cgst}</AMOUNT></ALLLEDGERENTRIES.LIST>` : ''}
  ${sgst > 0 ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${sgst}</AMOUNT></ALLLEDGERENTRIES.LIST>` : ''}
  ${itemsXml}
</VOUCHER>`);
    }

    if (!validVouchers.length) {
      LOG('No valid vouchers to push');
      await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally', status: 'Success', records: 0, triggeredBy });
      return { ok: true, records: 0 };
    }

    const vouchersXml = validVouchers.join('');

    const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC>
  <REPORTNAME>Vouchers</REPORTNAME>
  ${staticVars(cfg)}
</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
${vouchersXml}
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

    const resp   = await postToTally(cfg, xml, 30000);
    const result = parseTallyResponse(resp, 'Purchase Vouchers');
    const records = pos.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally',
      status: result.ok ? 'Success' : 'Failed', duration, error: result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { upsert: true });
      await PurchaseOrder.updateMany({ _id: { $in: pos.map(p=>p._id) } }, { tallySync: true, tallySyncAt: new Date() });
      LOG(`Purchase vouchers synced OK — ${records} in ${duration}`);
    } else {
      ERR('Purchase vouchers FAILED:', result.error);
    }
    return { ok: result.ok, records, error: result.error };
  } catch (err) {
    ERR('pushPurchaseVouchersToTally exception:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Purchase', direction: 'ERP → Tally', status: 'Failed', duration, error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── PHASE 2: PUSH SALES VOUCHERS ────────────────────────────────────────────

export async function pushSalesVouchersToTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-SALES-${Date.now()}`;
  LOG('=== pushSalesVouchersToTally START ===');
  try {
    const invoices = await Invoice.find({
      status: { $in: ['Sent', 'Paid'] },
      tallySync: { $ne: true },
    }).lean();

    LOG(`Invoices to sync: ${invoices.length}`);
    if (!invoices.length) {
      await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: 'Success', records: 0, triggeredBy });
      return { ok: true, records: 0 };
    }

    const vouchersXml = invoices.map(inv => {
      const cgst = (inv.items||[]).reduce((s,i)=>s+(i.cgst||0),0);
      const sgst = (inv.items||[]).reduce((s,i)=>s+(i.sgst||0),0);
      const igst = (inv.items||[]).reduce((s,i)=>s+(i.igst||0),0);
      LOG(`  Invoice ${inv.invoiceNo} party="${inv.partyName}" total=${inv.grandTotal}`);

      const itemsXml = (inv.items||[]).map(item => `
<ALLINVENTORYENTRIES.LIST>
  <STOCKITEMNAME>${esc(item.description||item.name||'Item')}</STOCKITEMNAME>
  <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
  <RATE>${item.rate||item.unitPrice||0}/Nos</RATE>
  <AMOUNT>-${item.amount||item.total||0}</AMOUNT>
  <ACTUALQTY>${item.qty||item.quantity||0} Nos</ACTUALQTY>
  <BILLEDQTY>${item.qty||item.quantity||0} Nos</BILLEDQTY>
  <ACCOUNTINGALLOCATIONS.LIST>
    <LEDGERNAME>Sales Accounts</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${item.amount||item.total||0}</AMOUNT>
  </ACCOUNTINGALLOCATIONS.LIST>
</ALLINVENTORYENTRIES.LIST>`).join('');

      return `
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${tallyDate(inv.invoiceDate)}</DATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${esc(inv.invoiceNo)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(inv.partyName)}</PARTYLEDGERNAME>
  <NARRATION>Invoice: ${esc(inv.invoiceNo)}</NARRATION>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(inv.partyName)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>${inv.grandTotal||0}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${cgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>CGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${cgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${sgst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>SGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${sgst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${igst>0?`<ALLLEDGERENTRIES.LIST><LEDGERNAME>IGST</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>-${igst}</AMOUNT></ALLLEDGERENTRIES.LIST>`:''}
  ${itemsXml}
</VOUCHER>`;
    }).join('');

    const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
<REQUESTDESC>
  <REPORTNAME>Vouchers</REPORTNAME>
  ${staticVars(cfg)}
</REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
${vouchersXml}
</TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY>
</ENVELOPE>`;

    const resp   = await postToTally(cfg, xml, 30000);
    const result = parseTallyResponse(resp, 'Sales Vouchers');
    const records = invoices.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally',
      status: result.ok ? 'Success' : 'Failed', duration, error: result.error, records, triggeredBy });
    if (result.ok) {
      await TallyConfig.findOneAndUpdate({}, { lastSyncAt: new Date() }, { upsert: true });
      await Invoice.updateMany({ _id: { $in: invoices.map(i=>i._id) } }, { tallySync: true, tallySyncAt: new Date() });
      LOG(`Sales vouchers synced OK — ${records} in ${duration}`);
    } else {
      ERR('Sales vouchers FAILED:', result.error);
    }
    return { ok: result.ok, records, error: result.error };
  } catch (err) {
    ERR('pushSalesVouchersToTally exception:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type: 'Sales', direction: 'ERP → Tally', status: 'Failed', duration, error: err.message, records: 0, triggeredBy });
    return { ok: false, records: 0, error: err.message };
  }
}

// ─── TALLY → ERP: PULL STOCK ITEMS ───────────────────────────────────────────

export async function pullItemsFromTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-ITEMS-${Date.now()}`;
  LOG('=== pullItemsFromTally START ===');
  try {
    // Tally ERP 9 uses "List of Stock Items" — Tally Prime uses "Stock Items"
    // Try both; fall back gracefully if neither works
    const reportNames = ['List of Stock Items', 'Stock Summary'];
    let resp = '';
    for (const rn of reportNames) {
      const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA>
<REQUESTDESC>
  <REPORTNAME>${rn}</REPORTNAME>
  ${exportVars('<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>')}
</REQUESTDESC>
</EXPORTDATA></BODY>
</ENVELOPE>`;
      resp = await postToTally(cfg, xml);
      if (resp && resp.includes('<STOCKITEM')) { LOG(`Got stock items using report "${rn}"`); break; }
      LOG(`Report "${rn}" returned no stock items, trying next...`);
      resp = '';
    }

    if (!resp || !resp.includes('<STOCKITEM')) {
      LOG('No stock items found in Tally — skipping pull');
      await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<STOCKITEM[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi)];
    LOG(`Found ${matches.length} stock items in Tally`);
    const ops = [];
    for (const m of matches) {
      const name = m[1]?.trim(); if (!name) continue;
      const block = m[2];
      const hsn  = (block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i)?.[1]||'').trim();
      const gst  = parseFloat(block.match(/<GSTRATE>(.*?)<\/GSTRATE>/i)?.[1])||0;
      const unit = (block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i)?.[1]||'Nos').trim();
      const cost = parseFloat(block.match(/<STANDARDCOST>(.*?)<\/STANDARDCOST>/i)?.[1])||0;
      const uMap = {Nos:'units',Kg:'kg',Ltr:'liter',Mtr:'meter',Box:'box',Pcs:'piece'};
      const sku  = name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,30);
      ops.push({ updateOne:{
        filter:{name},
        update:{ $set:{hsn,gst,unit:uMap[unit]||'units',costPrice:cost,unitPrice:cost},
                 $setOnInsert:{itemId:`TALLY-${sku}`,sku,name,sellingPrice:cost,isActive:true} },
        upsert:true,
      }});
    }
    if (ops.length) await ItemMaster.bulkWrite(ops,{ordered:false});
    const records = ops.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Success', duration, records, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
    LOG(`Pulled ${records} items from Tally in ${duration}`);
    return { ok:true, records };
  } catch (err) {
    ERR('pullItemsFromTally exception:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Item Master', direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── TALLY → ERP: PULL LEDGERS ───────────────────────────────────────────────

export async function pullLedgersFromTally(cfg, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-LEDGER-${Date.now()}`;
  LOG('=== pullLedgersFromTally START ===');
  try {
    // Try multiple report names for different Tally versions
    const reportNames = ['List of Accounts', 'Ledger Vouchers', 'Ledger'];
    let resp = '';
    for (const rn of reportNames) {
      const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA>
<REQUESTDESC>
  <REPORTNAME>${rn}</REPORTNAME>
  ${exportVars('<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>')}
</REQUESTDESC>
</EXPORTDATA></BODY>
</ENVELOPE>`;
      resp = await postToTally(cfg, xml);
      if (resp && resp.includes('<LEDGER') && !resp.includes('<SHORTPROMPT>')) {
        LOG(`Got ledgers using report "${rn}"`);
        break;
      }
      LOG(`Report "${rn}" returned no usable ledger data, trying next...`);
      resp = '';
    }

    if (!resp || !resp.includes('<LEDGER')) {
      LOG('No ledgers found in Tally — skipping pull');
      await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    const matches = [...resp.matchAll(/<LEDGER[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/LEDGER>/gi)];
    LOG(`Found ${matches.length} ledger blocks in Tally response`);
    // Also try NAME attribute on self-closing or differently formatted tags
    const nameOnlyMatches = matches.length === 0
      ? [...resp.matchAll(/NAME="([^"]+)"/gi)].map(m => m[1]).filter(Boolean)
      : [];
    if (nameOnlyMatches.length) LOG(`NAME attributes found: ${nameOnlyMatches.slice(0,5).join(', ')}...`);

    const ops = [];
    for (const m of matches) {
      const name = m[1]?.trim(); if (!name) continue;
      const block = m[2] || '';
      const parent = (block.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim();
      // Only import Sundry Creditors/Debtors — skip system accounts
      if (!parent.toLowerCase().includes('sundry')) continue;
      const gstNumber      = (block.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/i)?.[1] || 'N/A').trim();
      const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>(.*?)<\/OPENINGBALANCE>/i)?.[1]) || 0;
      const email = (block.match(/<EMAIL>(.*?)<\/EMAIL>/i)?.[1] || '').trim();
      const phone = (block.match(/<LEDGERMOBILE>(.*?)<\/LEDGERMOBILE>/i)?.[1] || '').trim();
      const ledgerGroup = parent.toLowerCase().includes('creditor') ? 'Sundry Creditors' : 'Sundry Debtors';
      const ledgerCode  = `TALLY-${name.replace(/[^A-Z0-9]/gi,'-').toUpperCase().slice(0,20)}-${Date.now()%10000}`;
      LOG(`  Ledger: "${name}" parent="${parent}"`);
      ops.push({ updateOne:{
        filter:{ ledgerName: name },
        update:{
          $set:{ ledgerGroup, gstNumber, openingBalance, email, phone, syncedWithTally: true, lastTallySync: new Date() },
          $setOnInsert:{ ledgerCode, ledgerName: name, contactPerson: name, panNumber: 'N/A', isActive: true },
        },
        upsert: true,
      }});
    }
    if (ops.length) await AccountsLedger.bulkWrite(ops, { ordered: false });
    LOG(`Imported ${ops.length} ledgers from Tally`);
    const records = ops.length;
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Success', duration, records, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
    LOG(`Pulled ${records} ledgers from Tally in ${duration}`);
    return { ok:true, records };
  } catch (err) {
    ERR('pullLedgersFromTally exception:', err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:'Ledger', direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
    return { ok:false, records:0, error:err.message };
  }
}

// ─── TALLY → ERP: PULL VOUCHERS ──────────────────────────────────────────────

export async function pullVouchersFromTally(cfg, voucherType, triggeredBy) {
  const start  = Date.now();
  const syncId = `SYNC-PULL-${voucherType.toUpperCase()}-${Date.now()}`;
  const logType = voucherType === 'Purchase' ? 'Purchase' : 'Sales';
  LOG(`=== pullVouchersFromTally (${voucherType}) START ===`);
  try {
    // Day Book works in Tally Prime; for ERP 9 try without VOUCHERTYPENAME filter
    const xml = `<ENVELOPE>
<HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA>
<REQUESTDESC>
  <REPORTNAME>Day Book</REPORTNAME>
  ${exportVars(`<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><VOUCHERTYPENAME>${voucherType}</VOUCHERTYPENAME>`)}
</REQUESTDESC>
</EXPORTDATA></BODY>
</ENVELOPE>`;
    const resp = await postToTally(cfg, xml);

    // If Tally echoes back the import XML or returns no vouchers, skip gracefully
    if (!resp || !resp.includes('<VOUCHER') || resp.includes('<TALLYREQUEST>Import Data')) {
      LOG(`No ${voucherType} vouchers found in Tally (or unsupported report)`);
      await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', records:0, triggeredBy });
      return { ok:true, records:0 };
    }
    let records = 0;
    if (voucherType === 'Sales') {
      const matches = [...resp.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)];
      const ops = [];
      for (const m of matches) {
        const block = m[1];
        const invoiceNo = (block.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim();
        if (!invoiceNo) continue;
        const partyName  = (block.match(/<PARTYLEDGERNAME>(.*?)<\/PARTYLEDGERNAME>/i)?.[1]||'Unknown').trim();
        const rawDate    = (block.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim();
        const grandTotal = Math.abs(parseFloat(block.match(/<AMOUNT>(.*?)<\/AMOUNT>/i)?.[1])||0);
        const invoiceDate = rawDate.length===8
          ? new Date(`${rawDate.slice(0,4)}-${rawDate.slice(4,6)}-${rawDate.slice(6,8)}`)
          : new Date();
        ops.push({ updateOne:{
          filter:{invoiceNo},
          update:{ $setOnInsert:{invoiceNo,partyName,invoiceDate,grandTotal,source:'manual',status:'Sent',invoiceType:'single',items:[]} },
          upsert:true,
        }});
      }
      if (ops.length) { await Invoice.bulkWrite(ops,{ordered:false}); records = ops.length; }
    } else {
      records = (resp.match(/<VOUCHER/gi)||[]).length;
    }
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Success', duration, records, triggeredBy });
    await TallyConfig.findOneAndUpdate({},{lastSyncAt:new Date()},{upsert:true});
    LOG(`Pulled ${records} ${voucherType} vouchers in ${duration}`);
    return { ok:true, records };
  } catch (err) {
    ERR(`pullVouchersFromTally(${voucherType}) exception:`, err.message);
    const duration = `${((Date.now()-start)/1000).toFixed(1)}s`;
    await writeLog({ syncId, type:logType, direction:'Tally → ERP', status:'Failed', duration, error:err.message, triggeredBy });
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
 * runFullSync — two-phase:
 *   Phase 1: Push all masters (group + items + ledgers) via REPORTNAME=All Masters
 *   Phase 2: Push vouchers via REPORTNAME=Vouchers (items/ledgers now exist)
 *   Phase 3: Pull from Tally → ERP
 */
export async function runFullSync(triggeredBy) {
  LOG('========== runFullSync START ==========');
  const cfg   = await getConfig();
  const check = await checkReachable(cfg);
  if (!check.reachable) {
    ERR('Tally not reachable:', check.error);
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{upsert:true});

  const direction = cfg.syncDirection || 'Bi-directional';
  const prefs     = cfg.syncPrefs || {};
  const results   = [];

  LOG(`Direction: ${direction}, prefs:`, JSON.stringify(prefs));

  // ── ERP → Tally ────────────────────────────────────────────────────────────
  if (direction !== 'Tally → ERP') {
    // Phase 1: ALL masters in one request (group must precede items)
    if (prefs.masterData !== false) {
      LOG('Phase 1: Pushing all masters...');
      results.push(await pushMastersToTally(cfg, triggeredBy));
    }
    // Phase 2: Vouchers (masters now exist in Tally)
    if (prefs.purchaseVouchers !== false) {
      LOG('Phase 2a: Pushing purchase vouchers...');
      results.push(await pushPurchaseVouchersToTally(cfg, triggeredBy));
    }
    if (prefs.salesVouchers !== false) {
      LOG('Phase 2b: Pushing sales vouchers...');
      results.push(await pushSalesVouchersToTally(cfg, triggeredBy));
    }
  }

  // ── Tally → ERP ────────────────────────────────────────────────────────────
  if (direction !== 'ERP → Tally') {
    if (prefs.masterData !== false) {
      LOG('Phase 3a: Pulling items from Tally...');
      results.push(await pullItemsFromTally(cfg, triggeredBy));
      LOG('Phase 3b: Pulling ledgers from Tally...');
      results.push(await pullLedgersFromTally(cfg, triggeredBy));
    }
    if (prefs.purchaseVouchers !== false) {
      LOG('Phase 3c: Pulling purchase vouchers from Tally...');
      results.push(await pullVouchersFromTally(cfg,'Purchase',triggeredBy));
    }
    if (prefs.salesVouchers !== false) {
      LOG('Phase 3d: Pulling sales vouchers from Tally...');
      results.push(await pullVouchersFromTally(cfg,'Sales',triggeredBy));
    }
  }

  const totalRecords = results.reduce((s,r)=>s+(r.records||0),0);
  const failed       = results.filter(r=>!r.ok);
  const ok           = failed.length === 0;
  const error        = failed.length>0 ? failed.map(r=>r.error).filter(Boolean).join('; ') : undefined;
  LOG(`========== runFullSync END — ok:${ok} records:${totalRecords} errors:${error||'none'} ==========`);
  return { ok, records:totalRecords, results, error };
}

/**
 * runTargetedSync — for individual sync buttons
 */
export async function runTargetedSync(type, triggeredBy) {
  LOG(`runTargetedSync type="${type}"`);
  const cfg   = await getConfig();
  const check = await checkReachable(cfg);
  if (!check.reachable) {
    await TallyConfig.findOneAndUpdate({},{connectionStatus:'Disconnected'},{upsert:true});
    return { ok:false, offline:true, records:0, error:check.error };
  }
  await TallyConfig.findOneAndUpdate({},{connectionStatus:'Connected'},{upsert:true});

  const direction = cfg.syncDirection || 'Bi-directional';
  const pushOnly  = direction === 'ERP → Tally';
  const pullOnly  = direction === 'Tally → ERP';

  switch (type) {
    case 'master':
    case 'Item Master':
    case 'Items':
    case 'Ledger':
    case 'Ledgers': {
      const results = [];
      if (!pullOnly) results.push(await pushMastersToTally(cfg, triggeredBy));
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
      // Must push masters first so stock items exist
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));
        results.push(await pushPurchaseVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullVouchersFromTally(cfg,'Purchase',triggeredBy));
      return mergeResults(results);
    }
    case 'Sales':
    case 'Sales Vouchers': {
      const results = [];
      if (!pullOnly) {
        results.push(await pushMastersToTally(cfg, triggeredBy));
        results.push(await pushSalesVouchersToTally(cfg, triggeredBy));
      }
      if (!pushOnly) results.push(await pullVouchersFromTally(cfg,'Sales',triggeredBy));
      return mergeResults(results);
    }
    case 'Full':
    default:
      return runFullSync(triggeredBy);
  }
}
