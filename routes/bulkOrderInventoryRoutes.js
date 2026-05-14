import express from 'express';
import * as bulkOrderInventoryController from '../controllers/bulkOrderInventoryController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Check inventory for order
router.post('/:orderId/check', protect, bulkOrderInventoryController.checkInventory);

// Reserve inventory
router.post('/:orderId/reserve', protect, bulkOrderInventoryController.reserveInventory);

// Create work order for shortage
router.post('/:orderId/create-work-order', protect, bulkOrderInventoryController.createWorkOrderForShortage);

// Release reserved inventory
router.post('/:orderId/release', protect, bulkOrderInventoryController.releaseReservedInventory);

export default router;
