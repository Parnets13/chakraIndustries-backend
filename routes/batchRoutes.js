import express from 'express';
import {
  getAllBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
  getAgeingReport
} from '../controllers/batchController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/ageing-report', protect, getAgeingReport);
router.get('/', protect, getAllBatches);
router.get('/:id', protect, getBatchById);
router.post('/', protect, createBatch);
router.put('/:id', protect, updateBatch);
router.delete('/:id', protect, deleteBatch);

export default router;
