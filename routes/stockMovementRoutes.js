import express from 'express';
import {
  getAllMovements,
  getMovementById,
  createMovement,
  transferStock,
  deleteMovement
} from '../controllers/stockMovementController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getAllMovements);
router.get('/:id', protect, getMovementById);
router.post('/', protect, createMovement);
router.post('/transfer', protect, transferStock);
router.delete('/:id', protect, deleteMovement);

export default router;
