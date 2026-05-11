import express from 'express';
import { getAllMRPRuns, getMRPRunById, runMRP, createPRsFromMRP, deleteMRPRun } from '../controllers/mrpController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/',         protect, getAllMRPRuns);
router.get('/:id',      protect, getMRPRunById);
router.post('/run',     protect, runMRP);
router.post('/:id/create-prs', protect, createPRsFromMRP);
router.delete('/:id',   protect, deleteMRPRun);

export default router;
