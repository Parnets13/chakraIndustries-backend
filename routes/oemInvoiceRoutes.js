import express from 'express';
import {
  getAllOEMInvoices, getOEMInvoicesByBrand, getOEMInvoiceById, createOEMInvoice,
  updateOEMInvoice, updateOEMInvoicePaymentStatus, recordOEMInvoicePayment,
  deleteOEMInvoice, getOEMInvoiceStats,
} from '../controllers/oemInvoiceController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Stats
router.get('/stats/dashboard', protect, getOEMInvoiceStats);

// All invoices
router.get('/', protect, getAllOEMInvoices);

// Invoices by brand
router.get('/brand/:brandId', protect, getOEMInvoicesByBrand);

// Single invoice
router.get('/:id', protect, getOEMInvoiceById);

// Create invoice
router.post('/', protect, createOEMInvoice);

// Update invoice
router.put('/:id', protect, updateOEMInvoice);

// Update payment status
router.put('/:id/payment-status', protect, updateOEMInvoicePaymentStatus);

// Record payment
router.post('/:id/payment', protect, recordOEMInvoicePayment);

// Delete invoice
router.delete('/:id', protect, deleteOEMInvoice);

export default router;
