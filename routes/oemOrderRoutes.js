import express from 'express';
import * as oemOrderController from '../controllers/oemOrderController.js';

const router = express.Router();

// Create OEM Order
router.post('/', oemOrderController.createOEMOrder);

// Get all OEM Orders
router.get('/', oemOrderController.getOEMOrders);

// Get OEM Order Summary
router.get('/summary/all', oemOrderController.getOEMOrderSummary);

// Get OEM Order by ID
router.get('/:id', oemOrderController.getOEMOrderById);

// Validate Inventory
router.post('/:id/validate-inventory', oemOrderController.validateInventory);

// Reserve Materials
router.post('/:id/reserve-materials', oemOrderController.reserveMaterials);

// Update OEM Order Status
router.put('/:id/status', oemOrderController.updateOEMOrderStatus);

// Get Workflow Status
router.get('/:id/workflow-status', oemOrderController.getOEMWorkflowStatus);

// Complete OEM Workflow
router.post('/:id/complete-workflow', oemOrderController.completeOEMWorkflow);

// Trigger Auto Workflows
router.post('/:id/trigger-workflow', oemOrderController.triggerAutoWorkflows);

export default router;
