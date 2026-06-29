import express from 'express';
import * as vendorController from '../controllers/vendorController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

// ── Named routes MUST come before /:id to avoid shadowing ──────────────────
router.get('/stats',           vendorController.getVendorStats);
router.get('/status/:status',  vendorController.getVendorsByStatus);
router.get('/prices/product',  vendorController.getPricesByProduct);

// Send email to vendor  (must be before /:id)
router.post('/send-email',     vendorController.sendVendorEmail);
// Diagnostic: test SMTP connection (GET /api/vendors/test-email)
router.get('/test-email',      vendorController.testEmailConfig);

// Vendor CRUD
router.get('/',                vendorController.getAllVendors);
router.post('/',               vendorController.createVendor);
router.get('/:id',             vendorController.getVendorById);
router.put('/:id',             vendorController.updateVendor);
router.delete('/:id',          vendorController.deleteVendor);

// Vendor Price Mapping
router.get('/:id/prices',                  vendorController.getVendorPrices);
router.post('/:id/prices',                 vendorController.addVendorPrice);
router.put('/:id/prices/:priceId',         vendorController.updateVendorPrice);
router.delete('/:id/prices/:priceId',      vendorController.deleteVendorPrice);

export default router;
