import express from 'express';
import {
  getAllInventory,
  getInventoryById,
  createInventory,
  updateInventory,
  deleteInventory,
  adjustStock,
  getDashboardStats
} from '../controllers/inventoryController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/stats', protect, getDashboardStats);
router.get('/', protect, getAllInventory);
router.get('/:id', protect, getInventoryById);
router.post('/', protect, createInventory);
router.put('/:id', protect, updateInventory);
router.delete('/:id', protect, deleteInventory);
router.patch('/:id/adjust', protect, adjustStock);

export default router;
