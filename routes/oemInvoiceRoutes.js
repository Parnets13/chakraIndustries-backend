import express from 'express';
import * as oemInvoiceController from '../controllers/oemInvoiceController.js';

const router = express.Router();

// Create Invoice
router.post('/', oemInvoiceController.createInvoice);

// Get all Invoices
router.get('/', oemInvoiceController.getInvoices);

// Get Invoice by ID
router.get('/:id', oemInvoiceController.getInvoiceById);

// Record Payment
router.post('/:id/payment', oemInvoiceController.recordPayment);

// Sync to Tally
router.post('/:id/sync-tally', oemInvoiceController.syncToTally);

// Get Invoice Summary
router.get('/summary/all', oemInvoiceController.getInvoiceSummary);

export default router;
