import express from 'express';
import {
  getConfig, saveConfig, fixConfig, testConnection,
  getSyncLogs, getSyncStats,
  getMasterDataStatus, getTransactionStatus,
  triggerSync, retrySync,
} from '../controllers/tallyController.js';
import { tallyWebhook } from '../controllers/tallyWebhookController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/config',           protect, getConfig);
router.post('/config',          protect, saveConfig);
router.post('/config/fix',      protect, fixConfig);       // one-time migration
router.post('/test-connection', protect, testConnection);
router.get('/logs',             protect, getSyncLogs);
router.get('/stats',            protect, getSyncStats);
router.get('/master-data',      protect, getMasterDataStatus);
router.get('/transactions',     protect, getTransactionStatus);
router.post('/sync',            protect, triggerSync);
router.post('/retry/:id',       protect, retrySync);
router.post('/webhook',         tallyWebhook);

export default router;
