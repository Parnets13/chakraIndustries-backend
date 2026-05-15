import express from 'express';
import { getAllApprovals, getApprovalStats, approveApproval, rejectApproval } from '../controllers/approvalController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getApprovalStats);
router.get('/', getAllApprovals);
router.patch('/:id/approve', approveApproval);
router.patch('/:id/reject', rejectApproval);

export default router;
