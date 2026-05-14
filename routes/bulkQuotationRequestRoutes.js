import express from 'express';
import * as bulkQuotationRequestController from '../controllers/bulkQuotationRequestController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Basic CRUD operations
router.post('/', protect, bulkQuotationRequestController.createBulkQuotationRequest);
router.get('/', protect, bulkQuotationRequestController.getAllBulkQuotationRequests);
router.get('/:id', protect, bulkQuotationRequestController.getBulkQuotationRequestById);

// Status management
router.put('/:id/status', protect, bulkQuotationRequestController.updateRequestStatus);
router.post('/:id/submit', protect, bulkQuotationRequestController.submitForApproval);
router.post('/:id/approve', protect, bulkQuotationRequestController.approveRequest);

// Workflow operations
router.post('/:id/inventory-check', protect, bulkQuotationRequestController.performInventoryCheck);
router.post('/:id/production-plan', protect, bulkQuotationRequestController.createProductionPlan);

// Query operations
router.get('/status/:status', protect, bulkQuotationRequestController.getRequestsByStatus);
router.get('/approvals/pending', protect, bulkQuotationRequestController.getPendingApprovals);
router.get('/dashboard/stats', protect, bulkQuotationRequestController.getDashboardStats);

export default router;