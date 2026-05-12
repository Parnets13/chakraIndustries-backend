import express from 'express';
import {
  getAllOEMOrders, getOEMOrdersByBrand, getOEMOrderById, createOEMOrder,
  updateOEMOrder, updateOEMOrderStatus, deleteOEMOrder, getOEMOrderStats,
} from '../controllers/oemOrderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Stats
router.get('/stats/dashboard', protect, getOEMOrderStats);

// All orders
router.get('/', protect, getAllOEMOrders);

// Orders by brand
router.get('/brand/:brandId', protect, getOEMOrdersByBrand);

// Single order
router.get('/:id', protect, getOEMOrderById);

// Create order
router.post('/', protect, createOEMOrder);

// Update order
router.put('/:id', protect, updateOEMOrder);

// Update status
router.put('/:id/status', protect, updateOEMOrderStatus);

// Delete order
router.delete('/:id', protect, deleteOEMOrder);

export default router;
