import express from 'express';
import {
  getAllDefectiveStock,
  getDefectiveStockById,
  getDefectLogs,
  createDefectiveStock,
  updateDefectiveStock,
  deleteDefectiveStock
} from '../controllers/defectiveStockController.js';

const router = express.Router();

router.get('/', getAllDefectiveStock);
router.get('/:id', getDefectiveStockById);
router.get('/:id/logs', getDefectLogs);
router.post('/', createDefectiveStock);
router.put('/:id', updateDefectiveStock);
router.delete('/:id', deleteDefectiveStock);

export default router;
