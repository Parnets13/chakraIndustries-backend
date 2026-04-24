import express from 'express';
import {
  getActivityLogs,
  getMyActivityLogs,
  getActivityStats,
  purgeLogs,
} from '../controllers/activityLogController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(protect);

// Any authenticated user — own logs
router.get('/my', getMyActivityLogs);

// super_admin + management — all logs
router.get('/', authorize('super_admin', 'management'), getActivityLogs);
router.get('/stats', authorize('super_admin', 'management'), getActivityStats);

// super_admin only — purge
router.delete('/purge', authorize('super_admin'), purgeLogs);

export default router;
