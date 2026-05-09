import express from 'express';
import {
  getRawMaterials,
  getMaterialWithStock,
  createBOM,
  getBOMs,
  getBOMById,
  updateBOM,
  deleteBOM,
  getBOMByProjectId,
  validateMaterialAvailability
} from '../controllers/bomController.js';

const router = express.Router();

// Materials endpoints
router.get('/materials/raw', getRawMaterials);
router.get('/materials/:materialId/stock', getMaterialWithStock);

// BOM CRUD
router.post('/', createBOM);
router.get('/', getBOMs);
router.get('/:id', getBOMById);
router.put('/:id', updateBOM);
router.delete('/:id', deleteBOM);

// Project-based BOM
router.get('/project/:projectId', getBOMByProjectId);

// Validation
router.post('/validate/availability', validateMaterialAvailability);

export default router;
