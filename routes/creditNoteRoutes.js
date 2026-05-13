import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getAll, getStats, create, updateStatus, sendReminder, remove } from '../controllers/creditNoteController.js';

const router = express.Router();
router.use(protect);
router.get('/', getAll);
router.get('/stats', getStats);
router.post('/', create);
router.patch('/:id/status', updateStatus);
router.post('/:id/send-reminder', sendReminder);
router.delete('/:id', remove);
export default router;
