import express from 'express';
import {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  toggleUserStatus,
  resetUserPassword,
  deleteUser,
} from '../controllers/userController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All routes require authentication
router.use(protect);

// super_admin + management can list users
router.get('/', authorize('super_admin', 'management'), getAllUsers);
router.get('/:id', authorize('super_admin', 'management'), getUserById);

// super_admin only — full CRUD
router.post('/', authorize('super_admin'), createUser);
router.put('/:id', authorize('super_admin'), updateUser);
router.put('/:id/toggle-status', authorize('super_admin'), toggleUserStatus);
router.put('/:id/reset-password', authorize('super_admin'), resetUserPassword);
router.delete('/:id', authorize('super_admin'), deleteUser);

export default router;
