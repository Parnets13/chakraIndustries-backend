import express from 'express';
import {
  getAllMovements,
  getMovementById,
  createMovement,
  transferStock,
  deleteMovement,
  getMovementsBySKU,
  getMovementsByWarehouse,
  getMovementsByLocation
} from '../controllers/stockMovementController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getAllMovements);
router.get('/sku/:sku', protect, getMovementsBySKU);
router.get('/warehouse/:warehouseId', protect, getMovementsByWarehouse);
router.get('/location/:locationId', protect, getMovementsByLocation);
router.get('/:id', protect, getMovementById);
router.post('/', protect, createMovement);
router.post('/transfer', protect, transferStock);
router.delete('/:id', protect, deleteMovement);

export default router;
