import express from 'express';
import * as brandOrderController from '../controllers/brandOrderController.js';

const router = express.Router();

// Create Brand Order
router.post('/', brandOrderController.createBrandOrder);

// Get all Brand Orders
router.get('/', brandOrderController.getBrandOrders);

// Get Brand Order by ID
router.get('/:id', brandOrderController.getBrandOrderById);

// Update Brand Order
router.put('/:id', brandOrderController.updateBrandOrder);

// Approve Brand Order
router.post('/:id/approve', brandOrderController.approveBrandOrder);

// Cancel Brand Order
router.post('/:id/cancel', brandOrderController.cancelBrandOrder);

export default router;
