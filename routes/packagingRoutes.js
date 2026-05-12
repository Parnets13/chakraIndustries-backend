import express from 'express';
import * as packagingController from '../controllers/packagingController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Get all packaging options
router.get('/', protect, packagingController.getAllPackaging);

// Get active packaging options
router.get('/active/list', protect, packagingController.getActivePackaging);

// Get packaging by type
router.get('/type/:type', protect, packagingController.getPackagingByType);

// Get packaging by ID
router.get('/:id', protect, packagingController.getPackagingById);

// Create new packaging option
router.post('/', protect, packagingController.createPackaging);

// Update packaging option
router.put('/:id', protect, packagingController.updatePackaging);

// Delete packaging option
router.delete('/:id', protect, packagingController.deletePackaging);

export default router;
