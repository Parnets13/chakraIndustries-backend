import express from 'express';
import {
  getAllPermissions,
  getPermissionByRole,
  updatePermission,
  seedPermissions,
} from '../controllers/permissionController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// super_admin + management can read
router.get('/', authorize('super_admin', 'management'), getAllPermissions);
router.get('/:role', authorize('super_admin', 'management'), getPermissionByRole);

// super_admin only — update
router.put('/:role', authorize('super_admin'), updatePermission);
router.post('/seed', authorize('super_admin'), seedPermissions);

export default router;
