import express from 'express';
import {
  register,
  login,
  getMe,
  changePassword,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
} from '../controllers/authController.js';
import { protect, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public
router.post('/register', register);
router.post('/login', login);

// Protected
router.get('/me', protect, getMe);
router.put('/change-password', protect, changePassword);

// Super Admin only
router.get('/users', protect, authorize('super_admin'), getAllUsers);
router.post('/users', protect, authorize('super_admin'), createUser);
router.put('/users/:id', protect, authorize('super_admin'), updateUser);
router.delete('/users/:id', protect, authorize('super_admin'), deleteUser);

export default router;
