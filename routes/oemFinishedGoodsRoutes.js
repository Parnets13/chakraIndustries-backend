import express from 'express';
import * as oemFinishedGoodsController from '../controllers/oemFinishedGoodsController.js';

const router = express.Router();

// Create Finished Goods
router.post('/', oemFinishedGoodsController.createFinishedGoods);

// Get all Finished Goods
router.get('/', oemFinishedGoodsController.getFinishedGoods);

// Get Finished Goods by ID
router.get('/:id', oemFinishedGoodsController.getFinishedGoodsById);

// Update Finished Goods Status
router.put('/:id/status', oemFinishedGoodsController.updateFinishedGoodsStatus);

// Get Finished Goods Summary
router.get('/summary/all', oemFinishedGoodsController.getFinishedGoodsSummary);

export default router;
