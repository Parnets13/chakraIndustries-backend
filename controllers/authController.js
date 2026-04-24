import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { logActivity } from '../utils/activityLogger.js';

const generateToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' });

const userResponse = (user, token) => ({
  success: true,
  token,
  user: {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    avatar: user.avatar || user.name.split(' ').map(n => n[0]).join('').toUpperCase(),
    createdAt: user.createdAt,
  },
});

// POST /api/auth/register
export const register = async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ success: false, message: 'Name, email and password are required' });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ success: false, message: 'Email already registered' });

    const user = await User.create({
      name, email, password,
      role: role || 'purchase_manager',
      avatar: name.split(' ').map(n => n[0]).join('').toUpperCase(),
    });

    const token = generateToken(user._id);
    await logActivity(req, user, 'REGISTER', {
      module: 'auth',
      description: `New user registered: ${email}`,
    });
    res.status(201).json(userResponse(user, token));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/auth/login
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password are required' });

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.isActive) {
      // log failed attempt if user exists but inactive
      if (user) {
        await logActivity(req, user, 'LOGIN_FAILED', {
          module: 'auth',
          description: 'Login attempt on inactive account',
          status: 'failure',
        });
      }
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      await logActivity(req, user, 'LOGIN_FAILED', {
        module: 'auth',
        description: 'Incorrect password',
        status: 'failure',
      });
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken(user._id);
    await logActivity(req, user, 'LOGIN', {
      module: 'auth',
      description: `User logged in`,
    });
    res.json(userResponse(user, token));
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/auth/logout  (protected)
export const logout = async (req, res) => {
  await logActivity(req, req.user, 'LOGOUT', {
    module: 'auth',
    description: 'User logged out',
  });
  res.json({ success: true, message: 'Logged out successfully' });
};

// GET /api/auth/me  (protected)
export const getMe = async (req, res) => {
  res.json({
    success: true,
    user: {
      id: req.user._id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      isActive: req.user.isActive,
      avatar: req.user.avatar,
      createdAt: req.user.createdAt,
    },
  });
};

// PUT /api/auth/change-password  (protected)
export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ success: false, message: 'Both passwords are required' });

    if (newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });

    const user = await User.findById(req.user._id).select('+password');
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      await logActivity(req, req.user, 'CHANGE_PASSWORD_FAILED', {
        module: 'auth',
        description: 'Incorrect current password',
        status: 'failure',
      });
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }

    user.password = newPassword;
    await user.save();

    await logActivity(req, req.user, 'CHANGE_PASSWORD', {
      module: 'auth',
      description: 'Password changed successfully',
    });
    res.json({ success: true, message: 'Password updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
