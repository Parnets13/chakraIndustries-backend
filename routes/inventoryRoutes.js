import express from 'express';
import {
  getAllInventory,
  getInventoryById,
  createInventory,
  updateInventory,
  deleteInventory,
  adjustStock,
  getDashboardStats,
  getStockByWarehouse,
  getStockByLocation,
  getStockBySKU,
  getStockTypeBreakdown,
  getAllStock
} from '../controllers/inventoryController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/stats', protect, getDashboardStats);
router.get('/stock', protect, getAllStock);
router.get('/stock/warehouse/:warehouseId', protect, getStockByWarehouse);
router.get('/stock/location/:locationId', protect, getStockByLocation);
router.get('/stock/sku/:sku', protect, getStockBySKU);
router.get('/stock/:sku/breakdown', protect, getStockTypeBreakdown);
router.get('/', protect, getAllInventory);
router.get('/:id', protect, getInventoryById);
router.post('/', protect, createInventory);
router.put('/:id', protect, updateInventory);
router.delete('/:id', protect, deleteInventory);
router.patch('/:id/adjust', protect, adjustStock);

export default router;
