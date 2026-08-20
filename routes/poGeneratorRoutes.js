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
  updateItemDispatch,
  getCompanyItems,
  getCompaniesSummary,
  listPendingOrders,
  updatePendingOrder,
  getStats,
  getUploadSummary,
  deleteInvoice,
  migrateHSN,
  listCompanies,
  createCompany,
  updateCompany,
  deleteCompany,
} from '../controllers/poGeneratorController.js';

const router = express.Router();
router.use(protect);

// Stats
router.get('/stats', getStats);
router.get('/upload-summary', getUploadSummary);

// Company management (must be before /:id patterns)
router.get('/companies',          listCompanies);
router.post('/companies',         createCompany);
router.put('/companies/:id',      updateCompany);
router.delete('/companies/:id',   deleteCompany);

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
router.patch('/invoices/:id/items/:itemId', updateItemDispatch);
router.delete('/invoices/:id', deleteInvoice);

// Company-wise item tracking
router.get('/company-items/:companyId', getCompanyItems);
router.get('/companies-summary',        getCompaniesSummary);

// Pending / backorders
router.get('/pending-orders', listPendingOrders);
router.patch('/pending-orders/:id', updatePendingOrder);

// One-time migration: extract HSN from itemName into hsn field
router.post('/migrate-hsn', migrateHSN);

export default router;
