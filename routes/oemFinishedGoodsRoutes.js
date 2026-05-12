import express from 'express';
import {
  getAllOEMFinishedGoods, getOEMFinishedGoodsByOrder, getOEMFinishedGoodsByBrand,
  getOEMFinishedGoodsById, createOEMFinishedGoods, updateOEMFinishedGoods,
  updateOEMFinishedGoodsStatus, deleteOEMFinishedGoods, getOEMFinishedGoodsStats,
} from '../controllers/oemFinishedGoodsController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Stats
router.get('/stats/dashboard', protect, getOEMFinishedGoodsStats);

// All finished goods
router.get('/', protect, getAllOEMFinishedGoods);

// Finished goods by brand
router.get('/brand/:brandId', protect, getOEMFinishedGoodsByBrand);

// Finished goods by order
router.get('/order/:orderId', protect, getOEMFinishedGoodsByOrder);

// Single finished goods
router.get('/:id', protect, getOEMFinishedGoodsById);

// Create finished goods
router.post('/', protect, createOEMFinishedGoods);

// Update finished goods
router.put('/:id', protect, updateOEMFinishedGoods);

// Update status
router.put('/:id/status', protect, updateOEMFinishedGoodsStatus);

// Delete finished goods
router.delete('/:id', protect, deleteOEMFinishedGoods);

export default router;
