import express from 'express';
import * as quotationClientController from '../controllers/quotationClientController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Basic CRUD operations
router.get('/', protect, quotationClientController.getAllQuotationClients);
router.get('/:id', protect, quotationClientController.getQuotationClientById);
router.put('/:id', protect, quotationClientController.updateQuotationClient);

// Corporate client integration
router.get('/corporate/:corporateId', protect, quotationClientController.getQuotationClientByCorporateId);

// Query operations
router.get('/tier/:tier', protect, quotationClientController.getQuotationClientsByTier);

export default router;