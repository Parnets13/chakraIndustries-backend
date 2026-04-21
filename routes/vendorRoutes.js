import express from 'express';
import * as vendorController from '../controllers/vendorController.js';

const router = express.Router();

// CRUD Operations
router.post('/', vendorController.createVendor);                    // CREATE
router.get('/', vendorController.getAllVendors);                    // READ ALL
router.get('/stats', vendorController.getVendorStats);              // READ STATS
router.get('/status/:status', vendorController.getVendorsByStatus); // READ BY STATUS
router.get('/:id', vendorController.getVendorById);                 // READ ONE
router.put('/:id', vendorController.updateVendor);                  // UPDATE
router.delete('/:id', vendorController.deleteVendor);               // DELETE

export default router;
