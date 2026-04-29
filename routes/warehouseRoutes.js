import express from 'express';
import {
  getAllWarehouses,
  getWarehouseById,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
  addZone,
  updateZone
} from '../controllers/warehouseController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getAllWarehouses);
router.get('/:id', protect, getWarehouseById);
router.post('/', protect, createWarehouse);
router.put('/:id', protect, updateWarehouse);
router.delete('/:id', protect, deleteWarehouse);
router.post('/:id/zones', protect, addZone);
router.put('/:id/zones/:zoneId', protect, updateZone);

export default router;
