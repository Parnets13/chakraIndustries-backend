import express from 'express';
import * as lossTrackingController from '../controllers/lossTrackingController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Apply auth middleware to all routes
router.use(protect);

// GET /api/loss-tracking - Get all loss tracking records with advanced filtering
router.get('/', lossTrackingController.getAllLossTracking);

// GET /api/loss-tracking/stats - Get legacy stats (backward compatibility)
router.get('/stats', lossTrackingController.getStats);

// GET /api/loss-tracking/analytics - Get comprehensive dashboard analytics
router.get('/analytics', lossTrackingController.getDashboardAnalytics);

// GET /api/loss-tracking/:id - Get single loss tracking record
router.get('/:id', lossTrackingController.getLossTrackingById);

// POST /api/loss-tracking - Create new loss tracking record
router.post('/', lossTrackingController.createLossTracking);

// PUT /api/loss-tracking/:id - Update loss tracking record
router.put('/:id', lossTrackingController.updateLossTracking);

// POST /api/loss-tracking/:id/debit-note - Raise debit note
router.post('/:id/debit-note', lossTrackingController.raiseDebitNote);

// POST /api/loss-tracking/:id/credit-note - Issue credit note
router.post('/:id/credit-note', lossTrackingController.issueCreditNote);

// POST /api/loss-tracking/:id/escalate - Escalate loss tracking record
router.post('/:id/escalate', lossTrackingController.escalateLoss);

// POST /api/loss-tracking/:id/close - Close loss tracking record
router.post('/:id/close', lossTrackingController.closeLossRecord);

// DELETE /api/loss-tracking/:id - Delete loss tracking record
router.delete('/:id', lossTrackingController.deleteLossTracking);

export default router;