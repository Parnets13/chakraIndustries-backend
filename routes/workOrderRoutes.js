import express from 'express';
import {
  getAllWorkOrders, getWorkOrderById, createWorkOrder,
  updateWorkOrder, releaseWorkOrder, updateProgress,
  recordConsumption, deductInventory, recordQC, recordWastage, deleteWorkOrder,
} from '../controllers/workOrderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/',    protect, getAllWorkOrders);
router.get('/:id', protect, getWorkOrderById);
router.post('/',   protect, createWorkOrder);
router.put('/:id', protect, updateWorkOrder);
router.delete('/:id', protect, deleteWorkOrder);

// Workflow
router.patch('/:id/release',          protect, releaseWorkOrder);
router.patch('/:id/progress',         protect, updateProgress);
router.patch('/:id/consume',          protect, recordConsumption);
router.post('/:id/deduct-inventory',  protect, deductInventory);
router.patch('/:id/qc',               protect, recordQC);
router.patch('/:id/wastage',          protect, recordWastage);

export default router;
