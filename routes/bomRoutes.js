import express from 'express';
import {
  getAllBOMs, getBOMById, getBOMVersions, createBOM, updateBOM, deleteBOM,
  createVersion, submitForApproval, approveBOM,
  addComponent, updateComponent, deleteComponent,
  addAlternate, deleteAlternate,
  explodeBOM,
} from '../controllers/bomController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// BOM CRUD
router.get('/',    protect, getAllBOMs);
router.get('/:id', protect, getBOMById);
router.post('/',   protect, createBOM);
router.put('/:id', protect, updateBOM);
router.delete('/:id', protect, deleteBOM);

// Versioning
router.get('/:id/versions',  protect, getBOMVersions);
router.post('/:id/version',  protect, createVersion);

// Approval workflow
router.post('/:id/submit',   protect, submitForApproval);
router.patch('/:id/approve', protect, approveBOM);

// BOM explosion (multi-level)
router.get('/:id/explode',   protect, explodeBOM);

// Component management
router.post('/:id/components',                              protect, addComponent);
router.put('/:id/components/:componentId',                  protect, updateComponent);
router.delete('/:id/components/:componentId',               protect, deleteComponent);

// Alternate materials
router.post('/:id/components/:componentId/alternates',                    protect, addAlternate);
router.delete('/:id/components/:componentId/alternates/:alternateId',     protect, deleteAlternate);

export default router;
