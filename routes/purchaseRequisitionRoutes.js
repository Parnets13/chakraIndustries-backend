import express from 'express';
import * as prController from '../controllers/purchaseRequisitionController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

// CRUD Operations
router.post('/', prController.createPurchaseRequisition);
router.get('/', prController.getAllPurchaseRequisitions);
router.get('/stats', prController.getPRStats);
router.get('/:id', prController.getPurchaseRequisitionById);
router.put('/:id', prController.updatePurchaseRequisition);
router.patch('/:id/status', prController.updatePRStatus);
router.delete('/:id', prController.deletePurchaseRequisition);

export default router;
