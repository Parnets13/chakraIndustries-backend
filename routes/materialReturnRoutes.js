import express from 'express';
import { getAll, getStats, create, updateStage, issueCreditNote, remove } from '../controllers/materialReturnController.js';

const router = express.Router();
router.get('/', getAll);
router.get('/stats', getStats);
router.post('/', create);
router.patch('/:id/stage', updateStage);
router.patch('/:id/credit-note', issueCreditNote);
router.delete('/:id', remove);
export default router;
