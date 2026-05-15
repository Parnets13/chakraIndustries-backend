import express from 'express';
import * as vendorController from '../controllers/vendorController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

// Vendor CRUD
router.post('/', vendorController.createVendor);
router.get('/stats', vendorController.getVendorStats);
router.get('/status/:status', vendorController.getVendorsByStatus);
router.get('/prices/product', vendorController.getPricesByProduct);
router.get('/', vendorController.getAllVendors);
router.get('/:id', vendorController.getVendorById);
router.put('/:id', vendorController.updateVendor);
router.delete('/:id', vendorController.deleteVendor);

// Vendor Price Mapping
router.get('/:id/prices', vendorController.getVendorPrices);
router.post('/:id/prices', vendorController.addVendorPrice);
router.put('/:id/prices/:priceId', vendorController.updateVendorPrice);
router.delete('/:id/prices/:priceId', vendorController.deleteVendorPrice);

export default router;
