import express from 'express';
import {
  getAllLocations,
  getLocationsByWarehouse,
  getLocationDetails,
  getLocationCapacity,
  createLocation,
  updateLocationCapacity,
  addBin,
  updateBinQuantity,
  deleteLocation
} from '../controllers/locationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', protect, getAllLocations);
router.get('/:id', protect, getLocationDetails);
router.get('/:id/capacity', protect, getLocationCapacity);
router.post('/', protect, createLocation);
router.put('/:id/capacity', protect, updateLocationCapacity);
router.post('/:id/bins', protect, addBin);
router.put('/:id/bins', protect, updateBinQuantity);
router.delete('/:id', protect, deleteLocation);

// Warehouse locations
router.get('/warehouse/:warehouseId', protect, getLocationsByWarehouse);

export default router;
