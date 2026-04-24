import User from '../models/User.js';
import { logActivity } from '../utils/activityLogger.js';

// GET /api/users  — super_admin + management
export const getAllUsers = async (req, res) => {
  try {
    const { role, isActive, search, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (role) filter.role = role;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [users, total] = await Promise.all([
      User.find(filter).select('-password').sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      User.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      users,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/users/:id
export const getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/users  — super_admin only
export const createUser = async (req, res) => {
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

    await logActivity(req, req.user, 'CREATE_USER', {
      module: 'users',
      description: `Created user: ${email} with role: ${user.role}`,
      targetId: user._id.toString(),
      targetType: 'User',
      metadata: { name, email, role: user.role },
    });

    res.status(201).json({ success: true, user: { ...user.toObject(), password: undefined } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/users/:id  — super_admin only
export const updateUser = async (req, res) => {
  try {
    const { name, role, isActive, avatar } = req.body;

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name, role, isActive, avatar },
      { new: true, runValidators: true }
    ).select('-password');

    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await logActivity(req, req.user, 'UPDATE_USER', {
      module: 'users',
      description: `Updated user: ${user.email}`,
      targetId: user._id.toString(),
      targetType: 'User',
      metadata: { name, role, isActive },
    });

    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/users/:id/toggle-status  — super_admin only
export const toggleUserStatus = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (req.params.id === req.user._id.toString())
      return res.status(400).json({ success: false, message: 'Cannot deactivate your own account' });

    user.isActive = !user.isActive;
    await user.save();

    await logActivity(req, req.user, user.isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER', {
      module: 'users',
      description: `User ${user.email} ${user.isActive ? 'activated' : 'deactivated'}`,
      targetId: user._id.toString(),
      targetType: 'User',
    });

    res.json({ success: true, message: `User ${user.isActive ? 'activated' : 'deactivated'}`, user });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/users/:id/reset-password  — super_admin only
export const resetUserPassword = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const user = await User.findById(req.params.id).select('+password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    user.password = newPassword;
    await user.save();

    await logActivity(req, req.user, 'RESET_USER_PASSWORD', {
      module: 'users',
      description: `Password reset for user: ${user.email}`,
      targetId: user._id.toString(),
      targetType: 'User',
    });

    res.json({ success: true, message: 'Password reset successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/users/:id  — super_admin only
export const deleteUser = async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString())
      return res.status(400).json({ success: false, message: 'Cannot delete your own account' });

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    await logActivity(req, req.user, 'DELETE_USER', {
      module: 'users',
      description: `Deleted user: ${user.email}`,
      targetId: req.params.id,
      targetType: 'User',
      metadata: { name: user.name, email: user.email, role: user.role },
    });

    res.json({ success: true, message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
