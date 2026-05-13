import express from 'express';
import { getAll, getStats, create, updateStage, issueCreditNote, remove } from '../controllers/materialReturnController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();
router.use(protect);

router.get('/stats', getStats);
router.get('/', getAll);
router.post('/', create);
router.patch('/:id/stage', updateStage);
router.patch('/:id/credit-note', issueCreditNote);
router.delete('/:id', remove);
export default router;
