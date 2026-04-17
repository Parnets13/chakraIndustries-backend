import express from 'express';
import { protect, authorize } from '../middleware/authMiddleware.js';
import {
  createVendor,
  getAllVendors,
  getVendorStats,
  getVendorsByStatus,
  getVendorById,
  updateVendor,
  deleteVendor,
  getVendorPrices,
  addVendorPrice,
  updateVendorPrice,
  deleteVendorPrice,
  getPricesByProduct,
} from '../controllers/vendorController.js';

const router = express.Router();

// All vendor routes require login
router.use(protect);

// ── Vendor CRUD ───────────────────────────────────────────────────────────────
router.get('/stats',           getVendorStats);
router.get('/status/:status',  getVendorsByStatus);
router.get('/prices/product',  getPricesByProduct);   // compare across vendors

router.get('/',    getAllVendors);
router.post('/',   authorize('super_admin', 'purchase_manager'), createVendor);
router.get('/:id', getVendorById);
router.put('/:id', authorize('super_admin', 'purchase_manager'), updateVendor);
router.delete('/:id', authorize('super_admin'), deleteVendor);

// ── Price Mapping ─────────────────────────────────────────────────────────────
router.get('/:id/prices',                authorize('super_admin', 'purchase_manager'), getVendorPrices);
router.post('/:id/prices',               authorize('super_admin', 'purchase_manager'), addVendorPrice);
router.put('/:id/prices/:priceId',       authorize('super_admin', 'purchase_manager'), updateVendorPrice);
router.delete('/:id/prices/:priceId',    authorize('super_admin'), deleteVendorPrice);

export default router;
