import express from 'express';
import {
  getConfig, saveConfig, fixConfig, testConnection,
  getSyncLogs, getSyncStats,
  getMasterDataStatus, getTransactionStatus,
  triggerSync, retrySync,
  getVouchers, getVoucherById, resetVoucherSyncStates, createVoucher, updateVoucher, deleteVoucher,
  fixBillToData,
  getGuidStatus,
  getTallyDashboardStats,
  resetInvoiceSyncFlags,
  // Directional streams (legacy)
  importFromTallyStream,
  exportToTallyStream,
  importFromTally,
  exportToTally,
  // New complete export system
  validateCompany,
  fullExportToTallyStream,
  selectiveExportStream,
  getExportCounts,
  // File-based import
  importFromTallyFiles,
  importFromTallyFilesStream,
  // Sales Register (April–June import + query)
  importSalesRegister,
  getSalesInvoices,
  // GST fields migration
  migrateGstFields,
  // PO Invoice export (separate from Sales export)
  poExportToTallyStream,
  getPOExportCount,
} from '../controllers/tallyController.js';
import { tallyWebhook } from '../controllers/tallyWebhookController.js';
import { protect } from '../middleware/authMiddleware.js';
import { getConnectorStatuses } from '../services/tallyConnectorServer.js';
import TallyConfig from '../models/TallyConfig.js';
import crypto from 'crypto';

const router = express.Router();

// ── Configuration ─────────────────────────────────────────────────────────────
router.get('/config',                protect, getConfig);
router.post('/config',               protect, saveConfig);
router.post('/config/fix',           protect, fixConfig);
router.post('/test-connection',      protect, testConnection);

// ── Stats & Logs ──────────────────────────────────────────────────────────────
router.get('/logs',                  protect, getSyncLogs);
router.get('/stats',                 protect, getSyncStats);
router.get('/dashboard-stats',       protect, getTallyDashboardStats);
router.get('/master-data',           protect, getMasterDataStatus);
router.get('/transactions',          protect, getTransactionStatus);

// ── Export counts (pre-flight) ────────────────────────────────────────────────
router.get('/export-counts',         protect, getExportCounts);

// ── Company validation ────────────────────────────────────────────────────────
router.post('/validate-company',     protect, validateCompany);

// ── IMPORT FROM TALLY (Tally → ERP) ──────────────────────────────────────────
// SSE stream — token passed as query param (EventSource limitation)
router.get('/import-stream',         importFromTallyStream);   // auth via ?token=
// Non-streaming POST
router.post('/import',               protect, importFromTally);
// File-based import endpoints
router.post('/import-from-files',    protect, importFromTallyFiles);
router.get('/import-from-files-stream', importFromTallyFilesStream); // auth via ?token=

// ── EXPORT TO TALLY — Complete new system (ERP → Tally) ─────────────────────
// Full export: all 14 entity types in dependency order
router.get('/full-export-stream',    fullExportToTallyStream); // auth via ?token=
// Selective export: single entity by key
router.get('/selective-export',      selectiveExportStream);   // auth via ?token=

// ── EXPORT TO TALLY — Legacy SSE stream (kept for backward compat) ────────────
router.get('/export-stream',         exportToTallyStream);     // auth via ?token=
// Legacy non-streaming POST
router.post('/export',               protect, exportToTally);

// ── Legacy sync endpoints (kept for backward compatibility) ───────────────────
router.post('/sync',                 protect, triggerSync);
router.post('/retry/:id',            protect, retrySync);

// ── Voucher management ────────────────────────────────────────────────────────
router.get('/vouchers',                    protect, getVouchers);
router.get('/vouchers/:id',                protect, getVoucherById);
router.post('/vouchers',                   protect, createVoucher);
router.patch('/vouchers/:id',              protect, updateVoucher);
router.delete('/vouchers/:id',             protect, deleteVoucher);
router.post('/reset-voucher-sync-states',  protect, resetVoucherSyncStates);
router.post('/reset-invoice-sync',         protect, resetInvoiceSyncFlags);
router.post('/fix-bill-to-data',           protect, fixBillToData);
router.post('/remigrate-gst-fields',       protect, migrateGstFields);

// ── GUID / AlterID sync status ────────────────────────────────────────────────
router.get('/guid-status',           protect, getGuidStatus);

// ── Sales Register: Import by date range + Query ──────────────────────────────
// POST /api/tally/import-sales-register  { fromDate, toDate }
router.post('/import-sales-register',protect, importSalesRegister);
// GET  /api/tally/sales-invoices?fromDate=2025-04-01&toDate=2025-06-30
router.get('/sales-invoices',        protect, getSalesInvoices);

// ── PO Invoice Export (separate from Sales Export) ────────────────────────────
// GET /api/tally/po-export-stream?token=<jwt>  — SSE stream
router.get('/po-export-stream',      poExportToTallyStream);  // auth via ?token=
// GET /api/tally/po-export-count   — pending invoice count
router.get('/po-export-count',       protect, getPOExportCount);

// ── Voucher export diagnostics — shows why Sales/Purchase are rejected ────────
router.get('/diagnose-vouchers', protect, async (req, res) => {
  try {
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.json({ success: false, error: 'No TallyConfig found' });

    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag   = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
    const results = {};

    // ── Connector-aware timeout helper ───────────────────────────────────────
    const ct = (baseMs) => (cfg.useConnector && cfg.connectorId)
      ? Math.max(baseMs * 3, 90000)
      : baseMs;

    // ── 1. VoucherType names ─────────────────────────────────────────────────
    try {
      const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VTList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="VTList"><TYPE>VoucherType</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
      const resp  = await postXmlWithRetry(cfg, xml, ct(60000));
      const names = [...resp.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
      results.voucherTypes = names;
    } catch (e) { results.voucherTypesError = e.message; }

    // ── 2. Relevant ledger names ─────────────────────────────────────────────
    try {
      const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>LedList</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="LedList"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;
      const resp    = await postXmlWithRetry(cfg, xml, ct(60000));
      const blocks  = [...resp.matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)].map(m => m[1]);
      const keywords = ['sales', 'purchase', 'cgst', 'sgst', 'igst', 'bi worldwide', 'debtor'];
      results.relevantLedgers = blocks
        .filter(b => keywords.some(k => b.toLowerCase().includes(k)))
        .map(b => ({
          name:   (b.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '?').trim(),
          parent: (b.match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '?').trim(),
        }));
    } catch (e) { results.ledgersError = e.message; }

    // ── 3. Minimal test Sales voucher — pure accounting, no items ────────────
    // Uses correct Tally sign conventions:
    //   Party debit: ISDEEMEDPOSITIVE=Yes, AMOUNT=-grandTotal (negative)
    //   Sales credit: ISDEEMEDPOSITIVE=No, AMOUNT=+salesBase (positive)
    // No inventory entries — simplest possible voucher to test if Sales type works at all.
    try {
      const salesVT = (results.voucherTypes || []).find(n => n.toLowerCase().startsWith('sale')) || 'Sales';
      const partyName = (results.relevantLedgers || []).find(l => l.parent?.toLowerCase().includes('sundry debtor'))?.name || 'BI Worldwide India PVT LTD';
      const salesLed  = (results.relevantLedgers || []).find(l => l.parent?.toLowerCase().includes('sales') && l.name?.toLowerCase() !== 'sales accounts')?.name || 'Sales';
      results.testUsing = { salesVT, partyName, salesLed, date: '20260702' };

      const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA>
  <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME>
    <STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES>
  </REQUESTDESC>
  <REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
    <VOUCHER VCHTYPE="${salesVT}" ACTION="Create" OBJVIEW="Invoice Voucher View">
      <DATE>20260702</DATE>
      <EFFECTIVEDATE>20260702</EFFECTIVEDATE>
      <VOUCHERTYPENAME>${salesVT}</VOUCHERTYPENAME>
      <VOUCHERNUMBER>TEST-DIAG-${Date.now()}</VOUCHERNUMBER>
      <PARTYLEDGERNAME>${partyName}</PARTYLEDGERNAME>
      <ISINVOICE>Yes</ISINVOICE>
      <NARRATION>ERP diagnostic test</NARRATION>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${partyName}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
        <ISLASTDEEMEDPOSITIVE>Yes</ISLASTDEEMEDPOSITIVE>
        <ISPARTYLEDGER>Yes</ISPARTYLEDGER>
        <AMOUNT>-100.00</AMOUNT>
        <BILLALLOCATIONS.LIST>
          <NAME>TEST-DIAG-BILL</NAME>
          <BILLTYPE>New Ref</BILLTYPE>
          <TDSDEDUCTEEISSPECIALRATE>No</TDSDEDUCTEEISSPECIALRATE>
          <AMOUNT>-100.00</AMOUNT>
        </BILLALLOCATIONS.LIST>
      </ALLLEDGERENTRIES.LIST>
      <ALLLEDGERENTRIES.LIST>
        <LEDGERNAME>${salesLed}</LEDGERNAME>
        <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
        <ISLASTDEEMEDPOSITIVE>No</ISLASTDEEMEDPOSITIVE>
        <ISPARTYLEDGER>No</ISPARTYLEDGER>
        <AMOUNT>100.00</AMOUNT>
      </ALLLEDGERENTRIES.LIST>
    </VOUCHER>
  </TALLYMESSAGE></REQUESTDATA>
</IMPORTDATA></BODY></ENVELOPE>`;
      const resp = await postXmlWithRetry(cfg, xml, ct(90000));
      results.testVoucherRaw        = resp.slice(0, 2000);
      results.testVoucherLineErrors = [...resp.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
      results.testVoucherCreated    = parseInt(resp.match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');
      results.testVoucherExceptions = parseInt(resp.match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1] || '0');
      // Clean up if created
      if (results.testVoucherCreated > 0) {
        try {
          const delXml = xml.replace('ACTION="Create"', 'ACTION="Delete"');
          await postXmlWithRetry(cfg, delXml, ct(30000));
          results.testVoucherDeleted = true;
        } catch (_) { results.testVoucherDeleted = false; }
      }
    } catch (e) { results.testVoucherError = e.message; }

    res.json({ success: true, data: results });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Tally-pushed webhook (no auth — secured by optional shared secret) ────────
router.post('/webhook',              tallyWebhook);

// ── DIAGNOSTIC: send ONE real failing invoice's exact XML to Tally and return
// the raw response + any LINEERROR. This uses the SAME serializer/normalizer as
// the real export so it reproduces the EXACTLY failing voucher, but sends it
// ALONE (single voucher) — which forces Tally to reveal the real error that it
// hides in a multi-voucher batch. Open in browser: /api/tally/diagnose-one?invoiceNo=BIW2522
// No auth required (read-only diagnostic that deletes any test voucher it creates).
router.get('/diagnose-one', async (req, res) => {
  try {
    const invoiceNo = req.query.invoiceNo || '';
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.json({ success: false, error: 'No TallyConfig' });

    const Invoice = (await import('../models/Invoice.js')).default;
    const ItemMaster = (await import('../models/ItemMaster.js')).default;
    const { normalizeToTallyVoucher } = await import('../services/normalizeToTallyVoucher.js');
    const { serializeTallyVoucher } = await import('../services/tallyExportService.js');
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');

    const inv = invoiceNo
      ? await Invoice.findOne({ invoiceNo }).lean()
      : await Invoice.findOne({ partyName: 'BI Worldwide India PVT LTD', tallySync: { $ne: true } }).lean();
    if (!inv) return res.json({ success: false, error: `Invoice ${invoiceNo} not found` });

    // Enrich items with ItemMaster hsn/ledger (same as export)
    const names = [...new Set((inv.items||[]).map(i => (i.description||i.name||'').trim()).filter(Boolean))];
    const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn tallySalesLedger').lean();
    const mMap = new Map(masters.map(m => [m.name, m]));
    const items = (inv.items||[]).map(it => {
      const im = mMap.get((it.description||it.name||'').trim());
      return { ...it, hsn: (it.hsn||'').trim()||(im?.hsn||'').trim(), tallySalesLedger: (it.tallySalesLedger||'').trim()||(im?.tallySalesLedger||'').trim() };
    });

    const tv = normalizeToTallyVoucher({ ...inv, items }, { salesVoucherTypeName: 'Sales' });
    const voucherXml = serializeTallyVoucher(tv, cfg, 'Create', '');

    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    // Send this ONE voucher alone with SVSHOWERRORLIST=Yes
    const envelope = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    let resp = await postXmlWithRetry(cfg, envelope, ct);

    let lineErrors = [...String(resp||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
    let lastErrors = [...String(resp||'').matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)].map(m => m[1].trim());
    let exceptions = parseInt(String(resp||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1] || '0');
    let created    = parseInt(String(resp||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');

    // ── Debug fallback: if Tally rejected but gave NO diagnostic, resend in
    // "XML (Data Interchange)" format which often forces the real LINEERROR out.
    let debugResp = null;
    if (exceptions > 0 && lineErrors.length === 0) {
      const dbgEnvelope = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST><SVEXPORTFORMAT>XML (Data Interchange)</SVEXPORTFORMAT></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      debugResp = await postXmlWithRetry(cfg, dbgEnvelope, ct);
      const dbgLine = [...String(debugResp||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
      const dbgLast = [...String(debugResp||'').matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)].map(m => m[1].trim());
      if (dbgLine.length) lineErrors = dbgLine;
      if (dbgLast.length) lastErrors = dbgLast;
    }

    res.json({
      success: true,
      invoiceNo: inv.invoiceNo,
      created, exceptions,
      lineErrors: lineErrors.length ? lineErrors : '(none returned by Tally)',
      lastErrors: lastErrors.length ? lastErrors : '(none returned by Tally)',
      rawResponse: String(resp||'').slice(0, 3000),
      debugResponse: debugResp ? String(debugResp).slice(0, 3000) : '(not needed)',
      sentXml: voucherXml,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, stack: e.stack });
  }
});

// ── DIAGNOSTIC: list ALL sales ledgers that actually exist in Tally ───────────
// Read-only. Open in browser:
//   /api/tally/list-sales-ledgers
// Returns every ledger whose parent group or name contains "sales" — the exact
// names as stored in Tally, so we can match ItemMaster.tallySalesLedger to them.
router.get('/list-sales-ledgers', async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.json({ success: false, error: 'No TallyConfig' });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');

    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
    const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllLed</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="AllLed"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const resp = await postXmlWithRetry(cfg, xml, ct, 3);

    const salesLedgers = [];
    for (const m of String(resp || '').matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
      const name = (m[1].match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
      const parent = (m[1].match(/<PARENT>(.*?)<\/PARENT>/i)?.[1] || '').trim();
      const low = name.toLowerCase();
      if (parent.toLowerCase().includes('sales') || low.includes('sale')) {
        salesLedgers.push(name);
      }
    }
    salesLedgers.sort();

    res.json({ success: true, count: salesLedgers.length, salesLedgers });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DIAGNOSTIC + AUTO-FIX: match every ItemMaster.tallySalesLedger against the
// LIVE Tally sales-ledger list. If a stored ledger does not EXACTLY exist in
// Tally but a case/space-insensitive equivalent does, fix it to the exact Tally
// name. Reports items whose ledger has NO match at all (need manual mapping).
// Open in browser:
//   /api/tally/audit-ledgers            -> report only (no changes)
//   /api/tally/audit-ledgers?apply=1    -> apply fixes + re-queue those invoices
router.get('/audit-ledgers', async (req, res) => {
  try {
    const apply = req.query.apply === '1';
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.json({ success: false, error: 'No TallyConfig' });
    const ItemMaster = (await import('../models/ItemMaster.js')).default;
    const Invoice = (await import('../models/Invoice.js')).default;
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');

    // 1) Live Tally ledgers (ALL, not just sales — a ledger might be under any group)
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
    const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllLed</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="AllLed"><TYPE>Ledger</TYPE><FETCH>Name,Parent</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
    const ctMs = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const resp = await postXmlWithRetry(cfg, xml, ctMs, 3);

    const liveNames = [];
    for (const m of String(resp || '').matchAll(/<LEDGER[^>]*>([\s\S]*?)<\/LEDGER>/gi)) {
      const name = (m[1].match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
      if (name) liveNames.push(name);
    }
    const norm = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*@\s*/g, '@').trim();
    const liveExact = new Set(liveNames);
    const liveByNorm = new Map();
    for (const n of liveNames) if (!liveByNorm.has(norm(n))) liveByNorm.set(norm(n), n);

    // 2) Go through ItemMaster ledgers
    const items = await ItemMaster.find(
      { tallySalesLedger: { $exists: true, $ne: '' } }, 'name tallySalesLedger'
    ).lean();

    const fixes = [];     // { item, from, to }
    const unmatched = []; // { item, ledger }
    for (const it of items) {
      const led = (it.tallySalesLedger || '').trim();
      if (liveExact.has(led)) continue;                 // already exact — good
      const eq = liveByNorm.get(norm(led));             // case/space-insensitive match
      if (eq) fixes.push({ item: it.name, from: led, to: eq });
      else unmatched.push({ item: it.name, ledger: led });
    }

    let applied = 0, requeued = 0;
    if (apply && fixes.length) {
      for (const f of fixes) {
        await ItemMaster.updateOne({ name: f.item }, { $set: { tallySalesLedger: f.to } });
        const affected = await Invoice.find(
          { $or: [ { 'items.description': f.item }, { 'items.name': f.item } ] }, 'items'
        ).lean();
        for (const inv of affected) {
          const newItems = (inv.items || []).map(x => {
            const key = (x.description || x.name || '').trim();
            return key === f.item ? { ...x, tallySalesLedger: f.to } : x;
          });
          await Invoice.updateOne(
            { _id: inv._id },
            { $set: { items: newItems, tallySync: false, tallyVoucher: null }, $unset: { tallySyncAt: '' } }
          );
          requeued++;
        }
        applied++;
      }
    }

    res.json({
      success: true,
      mode: apply ? 'APPLIED' : 'REPORT ONLY (add ?apply=1 to fix)',
      liveLedgerCount: liveNames.length,
      autoFixable: fixes,
      appliedCount: applied,
      invoicesRequeued: requeued,
      needManualMapping: unmatched,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DIAGNOSTIC: send a failing invoice as a MINIMAL voucher (strip extras) to
// isolate which field Tally rejects. Sends 3 progressively simpler versions of
// the SAME invoice and reports which one Tally accepts.
// Open: /api/tally/isolate-fail?invoiceNo=BIW2485
// It DELETES anything it creates so nothing pollutes Tally.
router.get('/isolate-fail', async (req, res) => {
  try {
    const invoiceNo = req.query.invoiceNo || '';
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.json({ success: false, error: 'No TallyConfig' });
    const Invoice = (await import('../models/Invoice.js')).default;
    const ItemMaster = (await import('../models/ItemMaster.js')).default;
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');

    const inv = await Invoice.findOne({ invoiceNo }).lean();
    if (!inv) return res.json({ success: false, error: `Invoice ${invoiceNo} not found` });

    const names = [...new Set((inv.items||[]).map(i => (i.description||i.name||'').trim()).filter(Boolean))];
    const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn tallySalesLedger').lean();
    const mMap = new Map(masters.map(m => [m.name, m]));

    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const esc = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const today = (() => { const n=new Date(); return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`; })();

    const party = inv.partyName || 'BI Worldwide India PVT LTD';
    const it0 = (inv.items||[])[0] || {};
    const itemName = (it0.description || it0.name || '').trim();
    const im = mMap.get(itemName) || {};
    const salesLed = (it0.tallySalesLedger || im.tallySalesLedger || 'Sales').trim();
    const qty = +(it0.qty || it0.quantity || 1);
    const base = +(it0.basic || 0) || +(it0.amount || 0) || (+(it0.rate||0)*qty);
    const cgst = +(it0.cgst || 0), sgst = +(it0.sgst || 0);
    const rate = qty ? +(base/qty).toFixed(2) : base;
    const grand = +(base + cgst + sgst).toFixed(2);

    // Minimal voucher: item invoice, sales ledger in accounting allocation,
    // CGST/SGST ledgers, NO RATEDETAILS, NO GSTSOURCETYPE/HSNSOURCETYPE, NO godown.
    const buildMinimal = (withGodown) => `
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${today}</DATE>
  <EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>ISOLATE-TEST-${Date.now()}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(party)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${grand.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Output CGST @ 9%</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${cgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>Output SGST @ 9%</LEDGERNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <AMOUNT>${sgst.toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>${rate}/Nos</RATE>
    <AMOUNT>${base.toFixed(2)}</AMOUNT>
    <ACTUALQTY> ${qty} Nos</ACTUALQTY>
    <BILLEDQTY> ${qty} Nos</BILLEDQTY>
    ${withGodown ? `<BATCHALLOCATIONS.LIST><GODOWNNAME>Srichakra Industries</GODOWNNAME><BATCHNAME>Primary Batch</BATCHNAME><AMOUNT>${base.toFixed(2)}</AMOUNT><ACTUALQTY> ${qty} Nos</ACTUALQTY><BILLEDQTY> ${qty} Nos</BILLEDQTY></BATCHALLOCATIONS.LIST>` : ''}
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(salesLed)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${base.toFixed(2)}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`;

    const send = async (voucherXml) => {
      const env = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      const r = await postXmlWithRetry(cfg, env, ct);
      const created = parseInt(String(r||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0');
      const exc = parseInt(String(r||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0');
      const line = [...String(r||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
      return { created, exceptions: exc, lineErrors: line, raw: String(r||'').slice(0,500) };
    };

    // Variant builder: choose the item name, sales ledger, and whether to add GST ledgers
    const buildVariant = ({ item, ledger, withGst }) => `
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${today}</DATE>
  <EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>ISOLATE-V-${Date.now()}-${Math.floor(Math.random()*1000)}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(party)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-${(withGst ? grand : base).toFixed(2)}</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  ${withGst ? `<ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${cgst.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>${sgst.toFixed(2)}</AMOUNT></ALLLEDGERENTRIES.LIST>` : ''}
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(item)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>${rate}/Nos</RATE>
    <AMOUNT>${base.toFixed(2)}</AMOUNT>
    <ACTUALQTY> ${qty} Nos</ACTUALQTY>
    <BILLEDQTY> ${qty} Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>${esc(ledger)}</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>${base.toFixed(2)}</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`;

    const results = {};
    results.itemUsed = { itemName, salesLed, base, cgst, sgst, rate, grand };
    results.test5_realLedger_withGst_noExtras = await send(buildVariant({ item: itemName, ledger: salesLed || 'Hand Blenders and Chopper Sales Local', withGst: true }));

    // test6: CLEAN ROUND numbers (rate 1000, cgst 90, sgst 90) with the chopper item.
    // If this CREATES ok but the real amounts fail -> it's a rounding/amount issue.
    // If this ALSO fails -> the stock item itself is corrupt in Tally.
    const ledgerT6 = salesLed || 'Hand Blenders and Chopper Sales Local';
    const t6 = `
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>ISOLATE-T6-${Date.now()}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(party)}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-1180.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>90.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>90.00</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(itemName)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>1000/Nos</RATE><AMOUNT>1000.00</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY><BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${esc(ledgerT6)}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1000.00</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`;
    results.test6_cleanRoundAmounts = await send(t6);

    res.json({ success: true, invoiceNo, results,
      note: 'test6 uses clean round numbers. If test6 CREATED>0 -> rounding/amount issue. If test6 also fails -> the stock item is corrupt in Tally.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message, stack: e.stack });
  }
});

// ── DIAGNOSTIC: compare the raw item data of a FAILING invoice vs a WORKING one.
// No Tally/connector needed — reads MongoDB only. Shows every item field so we
// can spot what differs (rate, qty, tax, name, hsn, ledger, unit).
// Open: /api/tally/compare-items?fail=BIW2485&ok=BIW2523
router.get('/compare-items', async (req, res) => {
  try {
    const Invoice = (await import('../models/Invoice.js')).default;
    const failNo = req.query.fail || '';
    const okNo   = req.query.ok   || '';

    const dump = async (no) => {
      if (!no) return null;
      const inv = await Invoice.findOne({ invoiceNo: no }).lean();
      if (!inv) return { invoiceNo: no, error: 'not found' };
      return {
        invoiceNo: inv.invoiceNo,
        invoiceDate: inv.invoiceDate,
        partyName: inv.partyName,
        subtotal: inv.subtotal, grandTotal: inv.grandTotal ?? inv.total,
        tallySync: inv.tallySync,
        items: (inv.items||[]).map(it => ({
          description: it.description || it.name,
          hsn: it.hsn, unit: it.unit,
          qty: it.qty ?? it.quantity,
          rate: it.rate, basic: it.basic, amount: it.amount,
          cgst: it.cgst, sgst: it.sgst, igst: it.igst, taxRate: it.taxRate,
          tallySalesLedger: it.tallySalesLedger,
        })),
      };
    };

    res.json({ success: true, failing: await dump(failNo), working: await dump(okNo) });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DIAGNOSTIC: how many pending-invoice items have a BLANK HSN? (DB only)
// Open: /api/tally/hsn-check
router.get('/hsn-check', async (req, res) => {
  try {
    const Invoice = (await import('../models/Invoice.js')).default;
    const pending = await Invoice.find(
      { tallySync: { $ne: true }, source: { $nin: ['Tally','tally'] } }, 'invoiceNo items'
    ).lean();

    const blankHsn = new Map();   // itemName -> { count, ledger }
    const okHsn = new Map();       // itemName -> hsn
    for (const inv of pending) {
      for (const it of (inv.items||[])) {
        const name = (it.description||it.name||'').trim();
        const hsn = (it.hsn||'').trim();
        if (!hsn) {
          if (!blankHsn.has(name)) blankHsn.set(name, { count: 0, ledger: it.tallySalesLedger||'' });
          blankHsn.get(name).count++;
        } else {
          if (!okHsn.has(name)) okHsn.set(name, hsn);
        }
      }
    }

    res.json({
      success: true,
      pendingInvoices: pending.length,
      itemsWithBlankHSN: [...blankHsn.entries()].map(([name, v]) => ({ name, invoiceCount: v.count, ledger: v.ledger })),
      itemsWithHSN: [...okHsn.entries()].map(([name, hsn]) => ({ name, hsn })),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── FIX: set HSN on the 3 items whose HSN is blank, in ItemMaster + pending
// invoices, and re-queue those invoices. DB only (no connector needed).
// Open: /api/tally/fix-hsn            -> report what will change
//       /api/tally/fix-hsn?apply=1    -> apply
router.get('/fix-hsn', async (req, res) => {
  try {
    const apply = req.query.apply === '1';
    const Invoice = (await import('../models/Invoice.js')).default;
    const ItemMaster = (await import('../models/ItemMaster.js')).default;

    // itemName -> { hsn, ledger }  — EXACT Tally values confirmed by the client.
    // NOTE the exact Tally ledger spellings ("Sale" not "Sales", "loacal" typo).
    const FIX_MAP = {
      'Rico 2509 Choper with Steel Bowl 3 Ltr': { hsn: '850940',  ledger: 'Hand Blenders and Chopper Sales Local' },
      'Electric Fan Heater New Areva 2000W':     { hsn: '85162900', ledger: 'Fan Heater Sale Local' },
      'Rico Sandwich Grill Toaster Blk SG2408':  { hsn: '85167200', ledger: 'Toasters sales loacal' },
    };
    const names = Object.keys(FIX_MAP);

    // 1) ItemMaster — set hsn + tallySalesLedger
    const imUpdates = [];
    for (const [name, fix] of Object.entries(FIX_MAP)) {
      const it = await ItemMaster.findOne({ name }, 'name hsn tallySalesLedger').lean();
      imUpdates.push({
        name, found: !!it,
        currentHsn: it?.hsn || '(none)', newHsn: fix.hsn,
        currentLedger: it?.tallySalesLedger || '(none)', newLedger: fix.ledger,
      });
      if (apply && it) await ItemMaster.updateOne({ name }, { $set: { hsn: fix.hsn, tallySalesLedger: fix.ledger } });
    }

    // 2) Pending invoices — set hsn + ledger on matching items, re-queue
    let requeued = 0;
    const affected = await Invoice.find(
      { $or: [ { 'items.description': { $in: names } }, { 'items.name': { $in: names } } ] },
      'invoiceNo items'
    ).lean();
    if (apply) {
      for (const inv of affected) {
        const newItems = (inv.items||[]).map(x => {
          const key = (x.description||x.name||'').trim();
          const fix = FIX_MAP[key];
          return fix ? { ...x, hsn: fix.hsn, tallySalesLedger: fix.ledger } : x;
        });
        await Invoice.updateOne(
          { _id: inv._id },
          { $set: { items: newItems, tallySync: false, tallyVoucher: null }, $unset: { tallySyncAt: '' } }
        );
        requeued++;
      }
    }

    res.json({
      success: true,
      mode: apply ? 'APPLIED' : 'REPORT ONLY (add ?apply=1 to fix)',
      itemMasterUpdates: imUpdates,
      invoicesAffected: affected.map(i => i.invoiceNo),
      invoicesRequeued: apply ? requeued : 0,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Compare the REAL serialized inventory XML of two invoices (fail vs working)
// so we can see the exact difference in the <ALLINVENTORYENTRIES.LIST> block.
// Open: /api/tally/diff-xml?fail=BIW2492&ok=BIW2456
router.get('/diff-xml', async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const Invoice = (await import('../models/Invoice.js')).default;
    const ItemMaster = (await import('../models/ItemMaster.js')).default;
    const { normalizeToTallyVoucher } = await import('../services/normalizeToTallyVoucher.js');
    const { serializeTallyVoucher } = await import('../services/tallyExportService.js');

    const buildXml = async (no) => {
      if (!no) return null;
      const inv = await Invoice.findOne({ invoiceNo: no }).lean();
      if (!inv) return { error: `${no} not found` };
      const names = [...new Set((inv.items||[]).map(i => (i.description||i.name||'').trim()).filter(Boolean))];
      const masters = await ItemMaster.find({ name: { $in: names } }, 'name hsn tallySalesLedger').lean();
      const mMap = new Map(masters.map(m => [m.name, m]));
      const items = (inv.items||[]).map(it => {
        const im = mMap.get((it.description||it.name||'').trim());
        return { ...it, hsn: (it.hsn||'').trim()||(im?.hsn||'').trim(), tallySalesLedger: (it.tallySalesLedger||'').trim()||(im?.tallySalesLedger||'').trim() };
      });
      const tv = normalizeToTallyVoucher({ ...inv, items }, { salesVoucherTypeName: 'Sales' });
      const xml = serializeTallyVoucher(tv, cfg, 'Create', '');
      // extract just the inventory block for easy comparison
      const invBlock = (xml.match(/<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/i)||[''])[0];
      return { invoiceNo: no, inventoryBlock: invBlock };
    };

    res.json({
      success: true,
      failing: await buildXml(req.query.fail),
      working: await buildXml(req.query.ok),
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Fetch an EXISTING (manually-created) voucher from Tally that uses the chopper
// item, so we can see EXACTLY how Tally stores a working chopper sale and compare
// it to what we send. Open: /api/tally/fetch-working-chopper
router.get('/fetch-working-chopper', async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;

    // Day Book export of ALL sales vouchers — then find one containing the chopper item
    const xml = `<ENVELOPE><HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
<BODY><EXPORTDATA><REQUESTDESC><REPORTNAME>Day Book</REPORTNAME>
<STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>20260401</SVFROMDATE><SVTODATE>20260930</SVTODATE></STATICVARIABLES>
</REQUESTDESC></EXPORTDATA></BODY></ENVELOPE>`;
    const resp = await postXmlWithRetry(cfg, xml, ct, 2);

    // find vouchers whose block contains "Choper" or "Chopper"
    const blocks = [...String(resp||'').matchAll(/<VOUCHER[\s\S]*?<\/VOUCHER>/gi)].map(m=>m[0]);
    const chopperVouchers = blocks.filter(b => /choper|chopper/i.test(b) && /VCHTYPE="Sales"/i.test(b));
    // return the first one's full XML (trimmed)
    res.json({
      success: true,
      totalVouchersInDaybook: blocks.length,
      chopperVouchersFound: chopperVouchers.length,
      firstChopperVoucherXml: chopperVouchers[0] ? chopperVouchers[0] : '(none found — no manual chopper sale in this period)',
      inventoryBlockOnly: chopperVouchers[0] ? (chopperVouchers[0].match(/<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/i)||['(no inventory block)'])[0] : '',
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── FINAL FIX: create a NEW clean stock item under a slightly different name,
// test that a voucher with it succeeds, and if so repoint the 12 chopper
// invoices (ItemMaster + invoices) to the new item. Nothing else changes.
// Open: /api/tally/new-chopper-item            -> create new item + test (no DB change)
//       /api/tally/new-chopper-item?apply=1     -> also repoint the 12 invoices
router.get('/new-chopper-item', async (req, res) => {
  try {
    const apply = req.query.apply === '1';
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const Invoice = (await import('../models/Invoice.js')).default;
    const ItemMaster = (await import('../models/ItemMaster.js')).default;
    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const OLD = 'Rico 2509 Choper with Steel Bowl 3 Ltr';
    const NEW = 'Rico 2509 Chopper with Steel Bowl 3 Ltr'; // "Chopper" (double p) — fresh clean master
    const LED = 'Hand Blenders and Chopper Sales Local';
    const today = (()=>{const n=new Date();return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;})();
    const send = async (xml) => await postXmlWithRetry(cfg, xml, ct);
    const out = {};

    // 1) Create the new clean stock item
    const createXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<STOCKITEM NAME="${NEW}" ACTION="Create">
  <NAME>${NEW}</NAME>
  <BASEUNITS>Nos</BASEUNITS>
  <GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>850940</HSNCODE>
  <GSTDETAILS.LIST>
    <APPLICABLEFROM>20230401</APPLICABLEFROM>
    <HSNCODE>850940</HSNCODE>
    <TAXABILITY>Taxable</TAXABILITY>
    <STATEWISEDETAILS.LIST>
      <STATENAME>&#4; Any</STATENAME>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKITEM>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const cResp = await send(createXml);
    out.itemCreated = parseInt(String(cResp||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0');
    out.itemAltered = parseInt(String(cResp||'').match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1]||'0');

    // 2) Test a voucher with the NEW item
    const vno = `NEWITEM-TEST-${Date.now()}`;
    const testXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${vno}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-2339.99</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${NEW}</STOCKITEMNAME>
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE><GSTLEDGERSOURCE>${LED}</GSTLEDGERSOURCE>
    <HSNSOURCETYPE>Ledger</HSNSOURCETYPE><HSNLEDGERSOURCE>${LED}</HSNLEDGERSOURCE>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>1983.05/Nos</RATE><AMOUNT>1983.05</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY><BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${LED}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1983.05</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
    <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 9.00</GSTRATE></RATEDETAILS.LIST>
    <RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 9.00</GSTRATE></RATEDETAILS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const tResp = await send(testXml);
    out.testCreated = parseInt(String(tResp||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0');
    out.testExceptions = parseInt(String(tResp||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0');
    // delete the test voucher if created
    if (out.testCreated) {
      await send(`<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Delete"><VOUCHERNUMBER>${vno}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><DATE>${today}</DATE></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`).catch(()=>{});
    }

    // 3) If test passed AND apply=1 → repoint the 12 invoices + ItemMaster to NEW name
    if (apply && out.testCreated) {
      // rename in ItemMaster (create/update a master row for NEW; keep OLD too)
      await ItemMaster.updateOne(
        { name: OLD },
        { $set: { name: NEW, tallySalesLedger: LED, hsn: '850940' } }
      ).catch(()=>{});
      const affected = await Invoice.find(
        { $or: [ { 'items.description': OLD }, { 'items.name': OLD } ] }, 'invoiceNo items'
      ).lean();
      let requeued = 0;
      for (const inv of affected) {
        const newItems = (inv.items||[]).map(x => {
          const key = (x.description||x.name||'').trim();
          if (key === OLD) {
            const y = { ...x, tallySalesLedger: LED, hsn: '850940' };
            if (y.description) y.description = NEW;
            if (y.name) y.name = NEW;
            return y;
          }
          return x;
        });
        await Invoice.updateOne(
          { _id: inv._id },
          { $set: { items: newItems, tallySync: false, tallyVoucher: null }, $unset: { tallySyncAt: '' } }
        );
        requeued++;
      }
      out.invoicesRepointed = requeued;
    }

    // 2b) If the new item failed, test the SAME new item with a KNOWN-GOOD ledger
    // ("Fan Heater Sale Local" which exported fine). If THIS works, the problem is
    // the "Hand Blenders and Chopper Sales Local" LEDGER as a GST source, not the item.
    if (!out.testCreated) {
      const GOODLED = 'Fan Heater Sale Local';
      const vno2 = `NEWITEM-GOODLED-${Date.now()}`;
      const t2 = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><VOUCHERNUMBER>${vno2}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>BI Worldwide India PVT LTD</PARTYLEDGERNAME><ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>BI Worldwide India PVT LTD</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-2339.99</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${NEW}</STOCKITEMNAME>
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE><GSTLEDGERSOURCE>${GOODLED}</GSTLEDGERSOURCE>
    <HSNSOURCETYPE>Ledger</HSNSOURCETYPE><HSNLEDGERSOURCE>${GOODLED}</HSNLEDGERSOURCE>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>1983.05/Nos</RATE><AMOUNT>1983.05</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY><BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${GOODLED}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1983.05</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
    <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 9.00</GSTRATE></RATEDETAILS.LIST>
    <RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 9.00</GSTRATE></RATEDETAILS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      const r2 = await send(t2);
      out.testWithGoodLedger_created = parseInt(String(r2||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0');
      out.testWithGoodLedger_exc = parseInt(String(r2||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0');
      if (out.testWithGoodLedger_created) {
        await send(`<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Delete"><VOUCHERNUMBER>${vno2}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><DATE>${today}</DATE></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`).catch(()=>{});
      }
    }

    res.json({ success: true, oldItem: OLD, newItem: NEW, result: out,
      note: 'testCreated=item+chopper ledger. testWithGoodLedger=same item + Fan Heater ledger. If GoodLedger works, the "Hand Blenders and Chopper Sales Local" LEDGER is the culprit.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── FINAL FIX: DELETE the corrupt chopper stock item and CREATE it fresh with
// proper Unit + GST + HSN. A fresh master clears whatever was corrupt.
// Then test a voucher automatically.
// Open: /api/tally/recreate-chopper-item
router.get('/recreate-chopper-item', async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const ITEM = 'Rico 2509 Choper with Steel Bowl 3 Ltr';
    const send = async (xml) => await postXmlWithRetry(cfg, xml, ct);
    const wrap = (body, extra='') => `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST>${extra}</STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${body}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
    const out = {};

    // 1) Delete the existing (corrupt) item
    const delXml = wrap(`<STOCKITEM NAME="${ITEM}" ACTION="Delete"><NAME>${ITEM}</NAME></STOCKITEM>`);
    const delResp = await send(delXml);
    out.deleted = parseInt(String(delResp||'').match(/<DELETED>(\d+)<\/DELETED>/i)?.[1]||'0');
    out.deleteExceptions = parseInt(String(delResp||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0');
    out.deleteRaw = String(delResp||'').slice(0,300);

    // 2) Create it fresh
    const createXml = wrap(`
<STOCKITEM NAME="${ITEM}" ACTION="Create">
  <NAME>${ITEM}</NAME>
  <BASEUNITS>Nos</BASEUNITS>
  <GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>850940</HSNCODE>
  <GSTDETAILS.LIST>
    <APPLICABLEFROM>20230401</APPLICABLEFROM>
    <HSNCODE>850940</HSNCODE>
    <TAXABILITY>Taxable</TAXABILITY>
    <STATEWISEDETAILS.LIST>
      <STATENAME>&#4; Any</STATENAME>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKITEM>`);
    const createResp = await send(createXml);
    out.created = parseInt(String(createResp||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0');
    out.createExceptions = parseInt(String(createResp||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0');
    out.createLineErrors = [...String(createResp||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());
    out.createRaw = String(createResp||'').slice(0,400);

    res.json({ success: true, item: ITEM, result: out,
      note: 'If deleted=1 & created=1 the item was rebuilt. Now run diagnose-one?invoiceNo=BIW2492 to confirm it exports.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── TEST: send chopper voucher WITHOUT GSTHSNNAME, and with 8-digit HSN, to see
// if the 6-digit HSN "850940" in GSTHSNNAME is the reject cause.
// Open: /api/tally/hsn-test
router.get('/hsn-test', async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const today = (()=>{const n=new Date();return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;})();
    const party = 'BI Worldwide India PVT LTD';
    const ITEM = 'Rico 2509 Choper with Steel Bowl 3 Ltr';
    const LED = 'Hand Blenders and Chopper Sales Local';

    // full real-style voucher, but hsnName is a parameter (or omitted)
    const build = (hsnName, vno) => `
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${vno}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>${party}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-2339.99</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${ITEM}</STOCKITEMNAME>
    <GSTOVRDNTAXABILITY>Taxable</GSTOVRDNTAXABILITY>
    <GSTSOURCETYPE>Ledger</GSTSOURCETYPE>
    <GSTLEDGERSOURCE>${LED}</GSTLEDGERSOURCE>
    <HSNSOURCETYPE>Ledger</HSNSOURCETYPE>
    <HSNLEDGERSOURCE>${LED}</HSNLEDGERSOURCE>
    <GSTRATEINFERAPPLICABILITY>As per Masters/Company</GSTRATEINFERAPPLICABILITY>
    ${hsnName ? `<GSTHSNNAME>${hsnName}</GSTHSNNAME>` : ''}
    <GSTHSNINFERAPPLICABILITY>As per Masters/Company</GSTHSNINFERAPPLICABILITY>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>1983.05/Nos</RATE><AMOUNT>1983.05</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY><BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST><LEDGERNAME>${LED}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1983.05</AMOUNT></ACCOUNTINGALLOCATIONS.LIST>
    <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 9.00</GSTRATE></RATEDETAILS.LIST>
    <RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE><GSTRATE> 9.00</GSTRATE></RATEDETAILS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`;

    const send = async (voucherXml) => {
      const env = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      const r = await postXmlWithRetry(cfg, env, ct);
      const del = async (vno) => { try { await postXmlWithRetry(cfg, `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Delete"><VOUCHERNUMBER>${vno}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><DATE>${today}</DATE></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, ct); } catch(_){} };
      return { r, del };
    };

    const results = {};
    // A: no GSTHSNNAME at all
    {
      const vno = `HSNT-NONE-${Date.now()}`;
      const { r } = await send(build('', vno));
      const created = parseInt(String(r||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0');
      results.A_noHsnName = { created, exceptions: parseInt(String(r||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0'), line: [...String(r||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim()) };
      if (created) await postXmlWithRetry(cfg, `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Delete"><VOUCHERNUMBER>${vno}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><DATE>${today}</DATE></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, ct).catch(()=>{});
    }

    // B: PURE ACCOUNTING voucher — NO stock item at all (party debit + sales credit + GST).
    // If this CREATES ok -> the STOCK ITEM is 100% the problem. If it fails too ->
    // problem is at party/ledger/company level, unrelated to the item.
    {
      const vno = `HSNT-NOITEM-${Date.now()}`;
      const voucherXml = `
<VOUCHER VCHTYPE="Sales" ACTION="Create">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${vno}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${party}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>${party}</LEDGERNAME><ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE><AMOUNT>-2339.99</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>${LED}</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1983.05</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output CGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
  <ALLLEDGERENTRIES.LIST><LEDGERNAME>Output SGST @ 9%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>178.47</AMOUNT></ALLLEDGERENTRIES.LIST>
</VOUCHER>`;
      const { r } = await send(voucherXml);
      const created = parseInt(String(r||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0');
      results.B_noStockItem = { created, exceptions: parseInt(String(r||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0'), line: [...String(r||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim()) };
      if (created) await postXmlWithRetry(cfg, `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}</STATICVARIABLES></REQUESTDESC><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Delete"><VOUCHERNUMBER>${vno}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><DATE>${today}</DATE></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`, ct).catch(()=>{});
    }

    res.json({ success: true, results,
      note: 'B_noStockItem: pure accounting voucher, no item. If B created=1 -> the STOCK ITEM is the problem. If B also fails -> party/ledger/company level.' });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── FIX: recreate/repair the chopper STOCK ITEM master in Tally with proper
// Unit + GST rate + HSN, then test a voucher. If the item master was corrupt,
// altering it fixes the silent reject.
// Open: /api/tally/repair-chopper-item
router.get('/repair-chopper-item', async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const ITEM = 'Rico 2509 Choper with Steel Bowl 3 Ltr';

    // Alter the stock item: ensure Unit=Nos, GST Applicable, HSN 850940, rate 18%.
    const masterXml = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">
<STOCKITEM NAME="${ITEM}" ACTION="Alter">
  <NAME>${ITEM}</NAME>
  <BASEUNITS>Nos</BASEUNITS>
  <GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>
  <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
  <HSNCODE>850940</HSNCODE>
  <GSTDETAILS.LIST>
    <APPLICABLEFROM>20230401</APPLICABLEFROM>
    <HSNCODE>850940</HSNCODE>
    <TAXABILITY>Taxable</TAXABILITY>
    <GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD>
    <STATEWISEDETAILS.LIST>
      <STATENAME>&#4; Any</STATENAME>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>CGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>SGST/UTGST</GSTRATEDUTYHEAD><GSTRATE>9</GSTRATE></RATEDETAILS.LIST>
      <RATEDETAILS.LIST><GSTRATEDUTYHEAD>IGST</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST>
    </STATEWISEDETAILS.LIST>
  </GSTDETAILS.LIST>
</STOCKITEM>
</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;

    const mResp = await postXmlWithRetry(cfg, masterXml, ct);
    const mAltered = parseInt(String(mResp||'').match(/<ALTERED>(\d+)<\/ALTERED>/i)?.[1]||'0');
    const mExc = parseInt(String(mResp||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0');
    const mLine = [...String(mResp||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim());

    res.json({
      success: true,
      item: ITEM,
      masterAltered: mAltered,
      masterExceptions: mExc,
      masterLineErrors: mLine.length ? mLine : '(none)',
      masterRaw: String(mResp||'').slice(0, 600),
      note: 'If masterAltered=1, the stock item was repaired. Now re-run export.',
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Check if specific voucher numbers ALREADY EXIST in Tally (duplicate check).
// Open: /api/tally/voucher-exists?nos=BIW2485,BIW2492,BIW2530
router.get('/voucher-exists', async (req, res) => {
  try {
    const wanted = (req.query.nos || '').split(',').map(s=>s.trim()).filter(Boolean);
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const company = (cfg.companyName||'').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
    const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>VNos</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="VNos"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,VoucherTypeName,Date</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const resp = await postXmlWithRetry(cfg, xml, ct, 3);

    const allNos = new Set();
    for (const m of String(resp||'').matchAll(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/gi)) {
      allNos.add(m[1].trim());
    }
    const result = wanted.map(n => ({ voucherNo: n, existsInTally: allNos.has(n) }));
    res.json({ success: true, totalVouchersInTally: allNos.size, checked: result });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DEFINITIVE TEST: send the SAME minimal voucher for TWO items — the failing
// Chopper and the working Fan Heater — identical in every way except item name.
// If Chopper fails and Fan Heater passes -> the Chopper STOCK ITEM is the problem.
// If both pass -> the export XML was the problem, not the item.
// Creates test vouchers then DELETES them. Open: /api/tally/twin-test
router.get('/twin-test', async (req, res) => {
  try {
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.json({ success: false, error: 'No TallyConfig' });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const co = (cfg.companyName||'').trim().toUpperCase();
    const coTag = co ? `<SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY>` : '';
    const esc = (s)=>String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const today = (()=>{const n=new Date();return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;})();
    const party = 'BI Worldwide India PVT LTD';

    // Identical numbers for both — only the STOCKITEMNAME differs.
    const build = (item, vno) => `
<VOUCHER VCHTYPE="Sales" ACTION="Create" OBJVIEW="Invoice Voucher View">
  <DATE>${today}</DATE><EFFECTIVEDATE>${today}</EFFECTIVEDATE>
  <VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>
  <VOUCHERNUMBER>${vno}</VOUCHERNUMBER>
  <PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>
  <ISINVOICE>Yes</ISINVOICE>
  <ALLLEDGERENTRIES.LIST>
    <LEDGERNAME>${esc(party)}</LEDGERNAME>
    <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
    <AMOUNT>-1000.00</AMOUNT>
  </ALLLEDGERENTRIES.LIST>
  <ALLINVENTORYENTRIES.LIST>
    <STOCKITEMNAME>${esc(item)}</STOCKITEMNAME>
    <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
    <RATE>1000/Nos</RATE>
    <AMOUNT>1000.00</AMOUNT>
    <ACTUALQTY> 1 Nos</ACTUALQTY>
    <BILLEDQTY> 1 Nos</BILLEDQTY>
    <ACCOUNTINGALLOCATIONS.LIST>
      <LEDGERNAME>Sales</LEDGERNAME>
      <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
      <AMOUNT>1000.00</AMOUNT>
    </ACCOUNTINGALLOCATIONS.LIST>
  </ALLINVENTORYENTRIES.LIST>
</VOUCHER>`;

    const send = async (voucherXml) => {
      const env = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}<SVSHOWERRORLIST>Yes</SVSHOWERRORLIST></STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF">${voucherXml}</TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      const r = await postXmlWithRetry(cfg, env, ct);
      return {
        created: parseInt(String(r||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1]||'0'),
        exceptions: parseInt(String(r||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1]||'0'),
        lineErrors: [...String(r||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m=>m[1].trim()),
      };
    };

    const del = async (vno) => {
      const env = `<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
<BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME><STATICVARIABLES>${coTag}</STATICVARIABLES></REQUESTDESC>
<REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="Sales" ACTION="Delete"><VOUCHERNUMBER>${vno}</VOUCHERNUMBER><VOUCHERTYPENAME>Sales</VOUCHERTYPENAME><DATE>${today}</DATE></VOUCHER></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>`;
      try { await postXmlWithRetry(cfg, env, ct); } catch(_){}
    };

    const vnoChop = `TWIN-CHOP-${Date.now()}`;
    const vnoFan  = `TWIN-FAN-${Date.now()}`;
    const chopper = await send(build('Rico 2509 Choper with Steel Bowl 3 Ltr', vnoChop));
    const fan     = await send(build('Electric Fan Heater New Areva 2000W', vnoFan));
    if (chopper.created) await del(vnoChop);
    if (fan.created) await del(vnoFan);

    let verdict;
    if (fan.created && !chopper.created) verdict = 'CONFIRMED: the Chopper STOCK ITEM is the problem (same voucher works for Fan Heater, fails for Chopper).';
    else if (fan.created && chopper.created) verdict = 'Both items accepted — the item is fine; the export XML was the issue.';
    else if (!fan.created && !chopper.created) verdict = 'Both failed — problem is not item-specific (party/ledger/company level).';
    else verdict = 'Chopper worked but Fan Heater failed — unexpected.';

    res.json({ success: true, chopper, fanHeater: fan, verdict });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── FIX: clear tallySalesLedger on the chopper item so the exporter auto-resolves
// it (exactly like the working Fan Heater whose ledger was blank). DB only.
// Open: /api/tally/clear-chopper-ledger          -> report
//       /api/tally/clear-chopper-ledger?apply=1  -> apply
router.get('/clear-chopper-ledger', async (req, res) => {
  try {
    const apply = req.query.apply === '1';
    // Default: set the CORRECT sales ledger (blank caused a wrong auto-resolve to
    // "AVR JEWELRY" customer ledger). Override with ?ledger=... if needed.
    const NEW_LEDGER = req.query.ledger != null ? req.query.ledger : 'Hand Blenders and Chopper Sales Local';
    const Invoice = (await import('../models/Invoice.js')).default;
    const ItemMaster = (await import('../models/ItemMaster.js')).default;
    const ITEM = 'Rico 2509 Choper with Steel Bowl 3 Ltr';

    const im = await ItemMaster.findOne({ name: ITEM }, 'name tallySalesLedger hsn').lean();
    const affected = await Invoice.find(
      { $or: [ { 'items.description': ITEM }, { 'items.name': ITEM } ] }, 'invoiceNo items'
    ).lean();

    if (apply) {
      await ItemMaster.updateOne({ name: ITEM }, { $set: { tallySalesLedger: NEW_LEDGER } });
      for (const inv of affected) {
        const newItems = (inv.items||[]).map(x => {
          const key = (x.description||x.name||'').trim();
          return key === ITEM ? { ...x, tallySalesLedger: NEW_LEDGER } : x;
        });
        await Invoice.updateOne(
          { _id: inv._id },
          { $set: { items: newItems, tallySync: false, tallyVoucher: null }, $unset: { tallySyncAt: '' } }
        );
      }
    }

    res.json({
      success: true,
      mode: apply ? 'APPLIED' : 'REPORT ONLY (add ?apply=1)',
      item: ITEM,
      itemMasterLedgerNow: im?.tallySalesLedger || '(none)',
      willBecome: NEW_LEDGER,
      invoicesAffected: affected.map(i => i.invoiceNo),
      count: affected.length,
    });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DIAGNOSTIC: fetch stock items from Tally matching a search term, so we can
// see the EXACT item name/HSN/GST as Tally stores it.
// Open: /api/tally/find-stock?q=Choper
router.get('/find-stock', async (req, res) => {
  try {
    const q = (req.query.q || '').toLowerCase();
    const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (!cfg) return res.json({ success: false, error: 'No TallyConfig' });
    const { postXmlWithRetry } = await import('../services/tallyFetchEngine.js');
    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';
    const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllStk</ID></HEADER>
<BODY><DESC><STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="AllStk"><TYPE>StockItem</TYPE><FETCH>Name,BaseUnits,GSTApplicable,HSNCode,GSTDetails,GSTTypeOfSupply,GSTRateDetails</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;
    const ct = (cfg.useConnector && cfg.connectorId) ? 90000 : 30000;
    const resp = await postXmlWithRetry(cfg, xml, ct, 3);

    const matches = [];
    for (const m of String(resp || '').matchAll(/<STOCKITEM[^>]*NAME="([^"]*)"[^>]*>([\s\S]*?)<\/STOCKITEM>/gi)) {
      const nameAttr = m[1];
      const block = m[2];
      const nameTag = (block.match(/<NAME>(.*?)<\/NAME>/i)?.[1] || '').trim();
      const name = (nameTag || nameAttr).trim();
      if (!q || name.toLowerCase().includes(q)) {
        const units = (block.match(/<BASEUNITS>(.*?)<\/BASEUNITS>/i)?.[1] || '').trim();
        const hsn = (block.match(/<HSNCODE>(.*?)<\/HSNCODE>/i)?.[1] || '').trim();
        // Include the FULL raw block so we can see every field Tally stores
        matches.push({ name, units, hsn, rawBlock: block.slice(0, 8000) });
      }
    }
    res.json({ success: true, query: q, count: matches.length, items: matches });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── Connector endpoints ───────────────────────────────────────────────────────
router.get('/connectors/status',     protect, async (req, res) => {
  try {
    const statuses = getConnectorStatuses();
    res.json({ success: true, connectors: statuses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/connectors/generate-credentials', protect, async (req, res) => {
  try {
    const existing = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    if (existing?.connectorId && existing?.connectorSecret) {
      return res.json({
        success: true,
        credentials: { connectorId: existing.connectorId, connectorSecret: existing.connectorSecret },
        message: 'Returning existing connector credentials (connector already registered)',
      });
    }
    const connectorId = crypto.randomUUID();
    const connectorSecret = crypto.randomBytes(32).toString('hex');
    await TallyConfig.findOneAndUpdate(
      {},
      { connectorId, connectorSecret, useConnector: true },
      { sort: { _id: 1 }, upsert: true, new: true }
    );
    res.json({ success: true, credentials: { connectorId, connectorSecret } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
