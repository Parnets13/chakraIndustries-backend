import express from 'express';
import {
  getConfig, saveConfig, fixConfig, testConnection,
  getSyncLogs, getSyncStats,
  getMasterDataStatus, getTransactionStatus,
  triggerSync, retrySync,
  getVouchers, getVoucherById, resetVoucherSyncStates, createVoucher, deleteVoucher,
  getGuidStatus,
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
router.delete('/vouchers/:id',             protect, deleteVoucher);
router.post('/reset-voucher-sync-states',  protect, resetVoucherSyncStates);

// ── GUID / AlterID sync status ────────────────────────────────────────────────
router.get('/guid-status',           protect, getGuidStatus);

// ── Sales Register: Import by date range + Query ──────────────────────────────
// POST /api/tally/import-sales-register  { fromDate, toDate }
router.post('/import-sales-register',protect, importSalesRegister);
// GET  /api/tally/sales-invoices?fromDate=2025-04-01&toDate=2025-06-30
router.get('/sales-invoices',        protect, getSalesInvoices);

// ── Tally-pushed webhook (no auth — secured by optional shared secret) ────────
router.post('/webhook',              tallyWebhook);

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
    // If a connector is already registered via /api/connector/register, do NOT overwrite
    // its connectorId/connectorSecret — doing so would break the existing connector's
    // Socket.IO authentication on the next reconnect attempt.
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
    
    // Update or create TallyConfig with credentials and enable connector mode
    await TallyConfig.findOneAndUpdate(
      {},
      { connectorId, connectorSecret, useConnector: true },
      { sort: { _id: 1 }, upsert: true, new: true }
    );
    
    res.json({
      success: true,
      credentials: { connectorId, connectorSecret }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

export default router;
