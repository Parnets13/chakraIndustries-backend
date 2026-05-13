import express from 'express';
import { getAllRFQs, getRFQById, createRFQ, updateRFQ, updateRFQStatus, addQuotation, deleteRFQ } from '../controllers/rfqController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/', getAllRFQs);
router.get('/:id', getRFQById);
router.post('/', createRFQ);
router.put('/:id', updateRFQ);
router.patch('/:id/status', updateRFQStatus);
router.post('/:id/quotations', addQuotation);
router.delete('/:id', deleteRFQ);

export default router;
