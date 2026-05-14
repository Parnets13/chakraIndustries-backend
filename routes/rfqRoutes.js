import express from 'express';
import {
  getAllRFQs,
  getRFQById,
  createRFQ,
  updateRFQ,
  updateRFQStatus,
  addQuotation,
  deleteRFQ,
  getPublicRFQ,
  addPublicQuotation
} from '../controllers/rfqController.js';

const router = express.Router();

router.get('/', getAllRFQs);
router.get('/:id', getRFQById);
router.post('/', createRFQ);
router.put('/:id', updateRFQ);
router.patch('/:id/status', updateRFQStatus);
router.post('/:id/quotations', addQuotation);
router.delete('/:id', deleteRFQ);

// Public vendor routes (no auth required)
router.get('/public/:id', getPublicRFQ);
router.post('/public/:id/quotations', addPublicQuotation);

export default router;
