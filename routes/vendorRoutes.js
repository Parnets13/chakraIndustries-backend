import express from 'express';
import * as vendorController from '../controllers/vendorController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// All vendor routes require authentication
router.use(protect);

// Vendor CRUD
router.post('/', vendorController.createVendor);
router.get('/', vendorController.getAllVendors);
router.get('/stats', vendorController.getVendorStats);
router.get('/status/:status', vendorController.getVendorsByStatus);
router.get('/:id', vendorController.getVendorById);
router.put('/:id', vendorController.updateVendor);
router.delete('/:id', vendorController.deleteVendor);

// Vendor Price Mapping
router.get('/:id/prices', vendorController.getVendorPrices);
router.post('/:id/prices', vendorController.addVendorPrice);
router.put('/:id/prices/:priceId', vendorController.updateVendorPrice);
router.delete('/:id/prices/:priceId', vendorController.deleteVendorPrice);

// Price comparison across vendors
router.get('/prices/product', vendorController.getPricesByProduct);

// Vendor Price Mapping Routes
router.get('/:id/prices', vendorController.getVendorPrices);        // GET all prices for vendor
router.post('/:id/prices', vendorController.addVendorPrice);        // ADD price entry
router.put('/:id/prices/:priceId', vendorController.updateVendorPrice); // UPDATE price entry
router.delete('/:id/prices/:priceId', vendorController.deleteVendorPrice); // DELETE price entry
router.get('/prices/product', vendorController.getPricesByProduct); // COMPARE prices across vendors

export default router;
