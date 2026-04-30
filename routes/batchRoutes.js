import express from 'express';
import {
  getAllBatches,
  getBatchById,
  createBatch,
  updateBatch,
  deleteBatch,
  getAgeingReport,
  getBatchesBySKU,
  getExpiringBatches,
  getBatchExpiry,
  updateBatchExpiry
} from '../controllers/batchController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/ageing-report', protect, getAgeingReport);
router.get('/expiring', protect, getExpiringBatches);
router.get('/sku/:sku', protect, getBatchesBySKU);
router.get('/', protect, getAllBatches);
router.get('/:id', protect, getBatchById);
router.get('/:id/expiry', protect, getBatchExpiry);
router.post('/', protect, createBatch);
router.put('/:id', protect, updateBatch);
router.put('/:id/expiry', protect, updateBatchExpiry);
router.delete('/:id', protect, deleteBatch);

export default router;
