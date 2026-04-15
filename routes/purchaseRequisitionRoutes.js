import express from 'express';
import * as prController from '../controllers/purchaseRequisitionController.js';

const router = express.Router();

// CRUD Operations
router.post('/', prController.createPurchaseRequisition);                 // CREATE
router.get('/', prController.getAllPurchaseRequisitions);                 // READ ALL
router.get('/stats', prController.getPRStats);                            // READ STATS
router.get('/:id', prController.getPurchaseRequisitionById);              // READ ONE
router.put('/:id', prController.updatePurchaseRequisition);               // UPDATE
router.patch('/:id/status', prController.updatePRStatus);                 // UPDATE STATUS
router.delete('/:id', prController.deletePurchaseRequisition);            // DELETE

export default router;
