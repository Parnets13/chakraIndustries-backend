import express from 'express';
import * as bulkOrderCreditController from '../controllers/bulkOrderCreditController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Check credit limit
router.post('/check', protect, bulkOrderCreditController.checkCreditLimit);

// Reserve credit
router.post('/:orderId/reserve', protect, bulkOrderCreditController.reserveCredit);

// Release credit
router.post('/:orderId/release', protect, bulkOrderCreditController.releaseCredit);

// Get credit summary
router.get('/:clientId/summary', protect, bulkOrderCreditController.getClientCreditSummary);

export default router;
