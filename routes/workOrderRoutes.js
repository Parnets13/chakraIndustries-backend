import express from 'express';
import * as workOrderController from '../controllers/workOrderController.js';

const router = express.Router();

// Auto-create from OEM Order
router.post('/from-oem', workOrderController.createWorkOrderFromOEM);

// Create Work Order manually
router.post('/', workOrderController.createWorkOrder);

// Get all Work Orders
router.get('/', workOrderController.getWorkOrders);

// Get Work Order by ID
router.get('/:id', workOrderController.getWorkOrderById);

// Approve Work Order
router.post('/:id/approve', workOrderController.approveWorkOrder);

// Validate Inventory
router.post('/:id/validate-inventory', workOrderController.validateInventory);

// Reserve Materials
router.post('/:id/reserve-materials', workOrderController.reserveMaterials);

// Start Production
router.post('/:id/start-production', workOrderController.startProduction);

// Update Produced Quantity
router.put('/:id/produced-qty', workOrderController.updateProducedQty);

// Complete Work Order
router.post('/:id/complete', workOrderController.completeWorkOrder);

// Hold Work Order
router.post('/:id/hold', workOrderController.holdWorkOrder);

// Cancel Work Order
router.post('/:id/cancel', workOrderController.cancelWorkOrder);

// Consume Materials
router.post('/:id/consume-materials', workOrderController.consumeMaterials);

// Get Work Order Summary
router.get('/summary/all', workOrderController.getWorkOrderSummary);

export default router;
