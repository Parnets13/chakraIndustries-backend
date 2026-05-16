import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  listPOs,
  deletePO,
  stockCheck,
  generateInvoice,
  generateInvoiceFromPDF,
  listInvoices,
  getInvoiceById,
  updateInvoiceStatus,
  updateDelivery,
  listPendingOrders,
  updatePendingOrder,
  getStats,
  deleteInvoice,
} from '../controllers/poGeneratorController.js';

const router = express.Router();
router.use(protect);

// Stats
router.get('/stats', getStats);

// PO listing for upload/selection
router.get('/pos', listPOs);
router.delete('/pos/:id', deletePO);

// Stock check for a specific PO
router.get('/stock-check/:poId', stockCheck);

// Generate partial/full invoice from PO in DB
router.post('/generate-invoice', generateInvoice);

// Generate invoice directly from PDF parsed data (no PO in DB needed)
router.post('/generate-invoice-from-pdf', generateInvoiceFromPDF);

// Invoice history
router.get('/invoices', listInvoices);
router.get('/invoices/:id', getInvoiceById);
router.patch('/invoices/:id/status', updateInvoiceStatus);
router.patch('/invoices/:id/delivery', updateDelivery);
router.delete('/invoices/:id', deleteInvoice);

// Pending / backorders
router.get('/pending-orders', listPendingOrders);
router.patch('/pending-orders/:id', updatePendingOrder);

export default router;
