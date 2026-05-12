import express from 'express';
import * as oemOrderEnhancedController from '../controllers/oemOrderEnhancedController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// ══════════════════════════════════════════════════════════════════════════════
// INVENTORY MANAGEMENT
// ══════════════════════════════════════════════════════════════════════════════

// Validate inventory and auto-generate PR if needed
router.post('/:id/validate-and-reserve', protect, oemOrderEnhancedController.validateAndReserveInventory);

// Reserve materials and proceed to production
router.post('/:id/reserve-proceed', protect, oemOrderEnhancedController.reserveAndProceed);

// Consume materials when production starts
router.post('/:id/consume-materials', protect, oemOrderEnhancedController.consumeMaterials);

// Release reserved materials (for cancellation)
router.post('/:id/release-materials', protect, oemOrderEnhancedController.releaseMaterials);

// Get inventory status
router.get('/:id/inventory-status', protect, oemOrderEnhancedController.getInventoryStatus);

// ══════════════════════════════════════════════════════════════════════════════
// COSTING & PROFITABILITY
// ══════════════════════════════════════════════════════════════════════════════

// Calculate estimated cost
router.post('/:id/calculate-estimated-cost', protect, oemOrderEnhancedController.calculateEstimated);

// Calculate actual cost after production
router.post('/:id/calculate-actual-cost', protect, oemOrderEnhancedController.calculateActual);

// Get cost breakdown
router.get('/:id/cost-breakdown', protect, oemOrderEnhancedController.getCostBreakdown);

// Get brand profitability
router.get('/brand/:brandId/profitability', protect, oemOrderEnhancedController.getBrandProfit);

// Get cost variance analysis
router.get('/brand/:brandId/variance-analysis', protect, oemOrderEnhancedController.getVarianceAnalysis);

// ══════════════════════════════════════════════════════════════════════════════
// TALLY INTEGRATION
// ══════════════════════════════════════════════════════════════════════════════

// Sync OEM order to Tally
router.post('/:id/sync-tally', protect, oemOrderEnhancedController.syncToTally);

// Get Tally sync status
router.get('/:id/tally-sync-status', protect, oemOrderEnhancedController.getTallySyncStatus);

// Retry failed Tally sync
router.post('/:id/retry-tally-sync', protect, oemOrderEnhancedController.retryTallySync);

// ══════════════════════════════════════════════════════════════════════════════
// PAYMENT & BILLING
// ══════════════════════════════════════════════════════════════════════════════

// Record payment for OEM invoice
router.post('/invoice/:invoiceId/record-payment', protect, oemOrderEnhancedController.recordPayment);

// ══════════════════════════════════════════════════════════════════════════════
// WORKFLOW & STATUS
// ══════════════════════════════════════════════════════════════════════════════

// Get full workflow status with all details
router.get('/:id/full-workflow-status', protect, oemOrderEnhancedController.getFullWorkflowStatus);

export default router;
