import express from 'express';
import {
  getAllDefectiveStock,
  getDefectiveStockById,
  createDefectiveStock,
  updateDefectiveStock,
  deleteDefectiveStock
} from '../controllers/defectiveStockController.js';

const router = express.Router();

router.get('/', getAllDefectiveStock);
router.get('/:id', getDefectiveStockById);
router.post('/', createDefectiveStock);
router.put('/:id', updateDefectiveStock);
router.delete('/:id', deleteDefectiveStock);

export default router;
