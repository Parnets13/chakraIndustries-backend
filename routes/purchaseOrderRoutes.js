import express from 'express';
import { getAllPOs, getPOById, createPO, updatePO, updatePOStatus, deletePO } from '../controllers/purchaseOrderController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/', getAllPOs);
router.get('/:id', getPOById);
router.post('/', createPO);
router.put('/:id', updatePO);
router.patch('/:id/status', updatePOStatus);
router.delete('/:id', deletePO);

export default router;
