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
    const resp = await postXmlWithRetry(cfg, envelope, ct);

    const lineErrors = [...String(resp||'').matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)].map(m => m[1].trim());
    const lastErrors = [...String(resp||'').matchAll(/<LASTERROR>([\s\S]*?)<\/LASTERROR>/gi)].map(m => m[1].trim());
    const exceptions = parseInt(String(resp||'').match(/<EXCEPTIONS>(\d+)<\/EXCEPTIONS>/i)?.[1] || '0');
    const created    = parseInt(String(resp||'').match(/<CREATED>(\d+)<\/CREATED>/i)?.[1] || '0');

    res.json({
      success: true,
      invoiceNo: inv.invoiceNo,
      created, exceptions,
      lineErrors: lineErrors.length ? lineErrors : '(none returned by Tally)',
      lastErrors: lastErrors.length ? lastErrors : '(none returned by Tally)',
      rawResponse: String(resp||'').slice(0, 3000),
      sentXml: voucherXml.slice(0, 6000),
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
