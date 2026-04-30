import express from 'express';
import {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  addZone,
  updateZone,
  getWarehouseCapacity,
  getWarehouseZones,
  getWarehouseSummary,
  syncWarehouseCapacity,
  getAllWarehousesWithData
} from '../controllers/warehouseController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get all warehouses with automatic data calculations
router.get('/data/all', protect, getAllWarehousesWithData);

// Standard warehouse endpoints
router.get('/', protect, getAllWarehouses);
router.get('/:id', protect, getWarehouseById);
router.get('/:id/capacity', protect, getWarehouseCapacity);
router.get('/:id/zones', protect, getWarehouseZones);
router.get('/:id/summary', protect, getWarehouseSummary);
router.get('/:id/sync', protect, syncWarehouseCapacity);

// Create, update, delete
router.post('/', protect, createWarehouse);
router.put('/:id', protect, updateWarehouse);
router.delete('/:id', protect, deleteWarehouse);

// Zone management
router.post('/:id/zones', protect, addZone);
router.put('/:id/zones/:zoneId', protect, updateZone);

export default router;
