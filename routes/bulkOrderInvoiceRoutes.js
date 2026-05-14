import express from 'express';
import * as bulkOrderInvoiceController from '../controllers/bulkOrderInvoiceController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Generate invoice from bulk order
router.post('/:orderId/generate-invoice', protect, bulkOrderInvoiceController.generateInvoiceFromBulkOrder);

// Get invoice for order
router.get('/:orderId/invoice', protect, bulkOrderInvoiceController.getInvoiceForOrder);

// Update invoice status
router.patch('/invoice/:invoiceId/status', protect, bulkOrderInvoiceController.updateInvoiceStatus);

// Get all invoices for client
router.get('/client/:clientId/invoices', protect, bulkOrderInvoiceController.getClientInvoices);

export default router;
