import express from 'express';
import {
  getAllWorkOrders, getWorkOrderById, createWorkOrder,
  updateWorkOrder, updateProgress, deleteWorkOrder,
} from '../controllers/workOrderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/',    protect, getAllWorkOrders);
router.get('/:id', protect, getWorkOrderById);
router.post('/',   protect, createWorkOrder);
router.put('/:id', protect, updateWorkOrder);
router.patch('/:id/progress', protect, updateProgress);
router.delete('/:id', protect, deleteWorkOrder);

export default router;
