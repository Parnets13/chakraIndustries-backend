import express from 'express';
import * as bulkQuotationController from '../controllers/bulkQuotationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', protect, bulkQuotationController.createBulkQuotation);
router.get('/', protect, bulkQuotationController.getAllBulkQuotations);
router.get('/:id', protect, bulkQuotationController.getBulkQuotationById);
router.put('/:id', protect, bulkQuotationController.updateBulkQuotation);
router.delete('/:id', protect, bulkQuotationController.deleteBulkQuotation);

export default router;
