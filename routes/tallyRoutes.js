import express from 'express';
import {
  getConfig, saveConfig, fixConfig, testConnection,
  getSyncLogs, getSyncStats,
  getMasterDataStatus, getTransactionStatus,
  triggerSync, retrySync,
  getVouchers, createVoucher, deleteVoucher,
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
} from '../controllers/tallyController.js';
import { tallyWebhook } from '../controllers/tallyWebhookController.js';
import { protect } from '../middleware/authMiddleware.js';

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

// ── Voucher management (payments & receipts) ──────────────────────────────────
router.get('/vouchers',              protect, getVouchers);
router.post('/vouchers',             protect, createVoucher);
router.delete('/vouchers/:id',       protect, deleteVoucher);

// ── GUID / AlterID sync status ────────────────────────────────────────────────
router.get('/guid-status',           protect, getGuidStatus);

// ── Tally-pushed webhook (no auth — secured by optional shared secret) ────────
router.post('/webhook',              tallyWebhook);

export default router;
