import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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
  // ── New PO Upload flow ──
  createPOUpload,
  listPOUploads,
  getPOUploadById,
  deletePOUpload,
  updatePOUploadItem,
  getPOCompaniesSummary,
  getPOCompanyDetail,
} from '../controllers/poGeneratorController.js';

// ── Multer setup for uploaded PO PDFs ─────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const poStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/po-uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '.pdf';
    cb(null, `po-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
  },
});
const poUpload = multer({ storage: poStorage, limits: { fileSize: 25 * 1024 * 1024 } });

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

// ── New PO Upload flow (records ordered vs sent, no invoice) ──────────────────
// Specific routes before parameterized ones
router.get('/po-companies-summary',        getPOCompaniesSummary);
router.get('/po-company/:companyId',       getPOCompanyDetail);
router.post('/po-uploads',                 poUpload.single('file'), createPOUpload);
router.get('/po-uploads',                  listPOUploads);
router.get('/po-uploads/:id',              getPOUploadById);
router.delete('/po-uploads/:id',           deletePOUpload);
router.patch('/po-uploads/:id/items/:itemId', updatePOUploadItem);

// Pending / backorders
router.get('/pending-orders', listPendingOrders);
router.patch('/pending-orders/:id', updatePendingOrder);

// One-time migration: extract HSN from itemName into hsn field
router.post('/migrate-hsn', migrateHSN);

export default router;
