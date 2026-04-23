import express from 'express';
import * as vendorController from '../controllers/vendorController.js';

const router = express.Router();

// CRUD Operations - Order matters! Specific routes MUST come before /:id
router.post('/', vendorController.createVendor);                    // CREATE
router.get('/', vendorController.getAllVendors);                    // READ ALL
router.get('/stats', vendorController.getVendorStats);              // READ STATS (MUST be before /:id)
router.get('/status/:status', vendorController.getVendorsByStatus); // READ BY STATUS (MUST be before /:id)
router.get('/:id', vendorController.getVendorById);                 // READ ONE
router.put('/:id', vendorController.updateVendor);                  // UPDATE
router.delete('/:id', vendorController.deleteVendor);               // DELETE

// Vendor Price Mapping Routes
router.get('/:id/prices', vendorController.getVendorPrices);        // GET all prices for vendor
router.post('/:id/prices', vendorController.addVendorPrice);        // ADD price entry
router.put('/:id/prices/:priceId', vendorController.updateVendorPrice); // UPDATE price entry
router.delete('/:id/prices/:priceId', vendorController.deleteVendorPrice); // DELETE price entry
router.get('/prices/product', vendorController.getPricesByProduct); // COMPARE prices across vendors

export default router;
