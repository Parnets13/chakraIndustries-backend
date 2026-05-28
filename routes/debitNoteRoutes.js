import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getAll, getStats, create, updateStatus, remove } from '../controllers/debitNoteController.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getStats);
router.get('/', getAll);
router.post('/', create);
router.patch('/:id/status', updateStatus);
router.delete('/:id', remove);

export default router;
