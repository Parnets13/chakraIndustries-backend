import express from 'express';
import { getAllApprovals, getApprovalStats, approveApproval, rejectApproval } from '../controllers/approvalController.js';

const router = express.Router();

router.get('/stats', getApprovalStats);
router.get('/', getAllApprovals);
router.patch('/:id/approve', approveApproval);
router.patch('/:id/reject', rejectApproval);

export default router;
