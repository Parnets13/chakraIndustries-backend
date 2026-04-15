import express from 'express';
import * as poController from '../controllers/purchaseOrderController.js';

const router = express.Router();

// CRUD Operations
router.post('/', poController.createPurchaseOrder);                 // CREATE
router.get('/', poController.getAllPurchaseOrders);                 // READ ALL
router.get('/stats', poController.getPOStats);                      // READ STATS
router.get('/:id', poController.getPurchaseOrderById);              // READ ONE
router.put('/:id', poController.updatePurchaseOrder);               // UPDATE
router.patch('/:id/status', poController.updatePOStatus);           // UPDATE STATUS
router.delete('/:id', poController.deletePurchaseOrder);            // DELETE

export default router;
