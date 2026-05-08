import express from 'express';
import {
  getAllBOMs, getBOMById, createBOM, updateBOM, deleteBOM,
  addComponent, updateComponent, deleteComponent,
} from '../controllers/bomController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/',    protect, getAllBOMs);
router.get('/:id', protect, getBOMById);
router.post('/',   protect, createBOM);
router.put('/:id', protect, updateBOM);
router.delete('/:id', protect, deleteBOM);

// Component management
router.post('/:id/components',                       protect, addComponent);
router.put('/:id/components/:componentId',           protect, updateComponent);
router.delete('/:id/components/:componentId',        protect, deleteComponent);

export default router;
