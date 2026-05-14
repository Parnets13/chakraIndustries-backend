import express from 'express';
import * as bulkOrderApprovalController from '../controllers/bulkOrderApprovalController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Create approval workflow
router.post('/', protect, bulkOrderApprovalController.createApprovalWorkflow);

// Get approval by ID
router.get('/:id', protect, bulkOrderApprovalController.getApprovalById);

// Get pending approvals
router.get('/', protect, bulkOrderApprovalController.getPendingApprovals);

// Approve at current level
router.patch('/:id/approve', protect, bulkOrderApprovalController.approveAtLevel);

// Reject approval
router.patch('/:id/reject', protect, bulkOrderApprovalController.rejectApproval);

// Get approval stats
router.get('/stats/summary', protect, bulkOrderApprovalController.getApprovalStats);

export default router;
