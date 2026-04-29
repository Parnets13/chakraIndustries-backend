import express from 'express';
import {
  getAllDefectiveStock,
  getDefectiveStockById,
  createDefectiveStock,
  updateDefectiveStock,
  updateStage,
  deleteDefectiveStock
} from '../controllers/defectiveStockController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getAllDefectiveStock);
router.get('/:id', protect, getDefectiveStockById);
router.post('/', protect, createDefectiveStock);
router.put('/:id', protect, updateDefectiveStock);
router.patch('/:id/stage', protect, updateStage);
router.delete('/:id', protect, deleteDefectiveStock);

export default router;
