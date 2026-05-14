import express from 'express';
import * as invoiceClientController from '../controllers/invoiceClientController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Basic CRUD operations
router.get('/', protect, invoiceClientController.getAllInvoiceClients);
router.get('/:id', protect, invoiceClientController.getInvoiceClientById);
router.put('/:id', protect, invoiceClientController.updateInvoiceClient);

// Corporate client integration
router.get('/corporate/:corporateId', protect, invoiceClientController.getInvoiceClientByCorporateId);

// GST and compliance operations
router.get('/gst/compliant', protect, invoiceClientController.getGSTCompliantClients);
router.get('/state/:state', protect, invoiceClientController.getClientsByState);

export default router;