import express from 'express';
import { getNotifications, dismissNotification, clearAllNotifications } from '../controllers/notificationController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);
router.get('/', getNotifications);
router.post('/:id/dismiss', dismissNotification);
router.post('/clear-all', clearAllNotifications);

export default router;
