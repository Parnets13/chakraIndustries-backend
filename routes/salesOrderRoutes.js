import express from 'express';
import { getAllOrders, getOrderStats, getOrderById, createOrder, updateOrder, deleteOrder } from '../controllers/salesOrderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.get('/', protect, getAllOrders);
router.get('/stats', protect, getOrderStats);
router.post('/', protect, createOrder);
router.get('/:id', protect, getOrderById);
router.put('/:id', protect, updateOrder);
router.delete('/:id', protect, deleteOrder);
export default router;
