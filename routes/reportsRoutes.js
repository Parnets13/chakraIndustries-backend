import express from 'express';
import { getSalesAnalytics, getStockSummary, getInventoryTurnover, getPurchaseRegister, getProductionReport, getReturnReconciliation } from '../controllers/reportsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.get('/sales-analytics', protect, getSalesAnalytics);
router.get('/stock-summary', protect, getStockSummary);
router.get('/inventory-turnover', protect, getInventoryTurnover);
router.get('/purchase-register', protect, getPurchaseRegister);
router.get('/production', protect, getProductionReport);
router.get('/return-reconciliation', protect, getReturnReconciliation);
export default router;
