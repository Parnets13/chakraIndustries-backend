import User from '../models/User.js';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Upload directory — create ONCE at startup, not per-request ──────────────
// Pehle yeh per-request check ho raha tha jisme fs.mkdirSync uncaught throw
// kar sakta tha aur poora connection crash ho jaata tha. Ab yeh sirf ek baar,
// server start hote hi bana diya jaayega.
const uploadDir = path.join(__dirname, '../uploads/employees');
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
    console.log('✓ Created upload directory:', uploadDir);
  }
} catch (err) {
  console.error('🔥 Failed to create upload directory at startup:', err);
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Ab yahan sirf existing folder pass ho raha hai — koi fs write nahi,
    // isliye yeh callback crash nahi kar sakta.
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    try {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, 'emp-' + uniqueSuffix + path.extname(file.originalname));
    } catch (err) {
      // Agar kuch bhi galat naam ki wajah se throw kare, to crash ki jagah
      // multer ko error properly bata do — yeh phir handleUpload middleware
      // ke through 400 response ban jaayega, connection drop nahi hoga.
      cb(err);
    }
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for mobile camera photos
  fileFilter: (req, file, cb) => {
    // React Native often sends application/octet-stream or image/jpeg with odd names
    const allowed = /jpeg|jpg|png|gif|webp|octet-stream|image/;
    const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
    const extOk = !ext || /jpe?g|png|gif|webp/.test(ext);
    const mimeOk = !file.mimetype || allowed.test(file.mimetype.toLowerCase());
    if (extOk || mimeOk) {
      return cb(null, true);
    }
    cb(new Error(`Invalid image type: ${file.mimetype || 'unknown'}`));
  },
});

const generateToken = (id) =>
  jwt.sign({ id, type: 'employee' }, process.env.JWT_SECRET, { expiresIn: '7d' });

const publicEmployee = (user) => ({
  id: user._id,
  userId: user._id,
  employeeId: `EMP-${String(user._id).slice(-6).toUpperCase()}`,
  name: user.name,
  fullName: user.name,
  email: user.email,
  mobileNumber: user.mobileNumber || user.mobile,
  department: user.department,
  designation: user.designation,
  joiningDate: user.joiningDate,
  gender: user.gender,
  gstNumber: user.gstNumber,
  panNumber: user.panNumber,
  industry: user.industry,
  address: user.address,
  profilePhoto: user.photo || user.profilePhoto || '',
  photo: user.photo || user.profilePhoto || '',
  role: user.role,
  isActive: user.isActive,
  isVerified: user.isVerified,
  createdAt: user.createdAt,
});

// Register employee
export const registerEmployee = async (req, res) => {
  console.log("========== REGISTER API HIT ==========");
  console.log("BODY:", req.body);
  console.log("FILE:", req.file);

  try {
    const {
      fullName,
      mobileNumber,
      email,
      password,
      confirmPassword,
      department,
      designation,
      joiningDate,
      gender,
      gstNumber,
      panNumber,
      industry,
      address,
      userRole
    } = req.body;

    // Validate required fields
    if (!fullName?.trim()) return res.status(400).json({ success: false, message: 'Full name is required' });
    if (!mobileNumber?.trim()) return res.status(400).json({ success: false, message: 'Mobile number is required' });
    if (!email?.trim()) return res.status(400).json({ success: false, message: 'Email is required' });
    if (!password) return res.status(400).json({ success: false, message: 'Password is required' });
    if (password.length < 6) return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
    if (password !== confirmPassword) return res.status(400).json({ success: false, message: 'Passwords do not match' });
    if (!department) return res.status(400).json({ success: false, message: 'Department is required' });
    if (!designation?.trim()) return res.status(400).json({ success: false, message: 'Designation is required' });
    if (!joiningDate) return res.status(400).json({ success: false, message: 'Joining date is required' });
    if (!gender) return res.status(400).json({ success: false, message: 'Gender is required' });

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [
        { email: email?.toLowerCase() },
        { mobile: mobileNumber },
        { mobileNumber }
      ]
    });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'User with this email or mobile already exists' });
    }

    // Handle profile photo
    let profilePhoto = '';
    if (req.file) {
      profilePhoto = `/uploads/employees/${req.file.filename}`;
    }

    // Create user
    const user = await User.create({
      name: fullName?.trim(),
      email: email?.toLowerCase()?.trim(),
      mobile: mobileNumber?.trim(),
      mobileNumber: mobileNumber?.trim(),
      password,
      role: userRole || 'employee',
      department: department?.trim(),
      designation: designation?.trim(),
      joiningDate: new Date(joiningDate),
      gender,
      gstNumber: gstNumber?.toUpperCase()?.trim(),
      panNumber: panNumber?.toUpperCase()?.trim(),
      industry: industry?.trim(),
      address: address?.trim(),
      photo: profilePhoto,
      profilePhoto,
      isActive: true,
      isVerified: true,
      avatar: fullName?.split(' ').map(n => n[0]).join('').toUpperCase(),
    });

    const token = generateToken(user._id);
    res.status(201).json({
      success: true,
      message: 'Employee registered successfully',
      token,
      user: publicEmployee(user),
    });
  } catch (error) {
    console.error('registerEmployee error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ success: false, message: `${field} is already registered` });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to register employee' });
  }
};

// Login employee with email/password
export const loginEmployee = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({
      email: email?.toLowerCase(),
      role: { $in: ['employee', 'delivery_logistics'] },
    }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account is inactive. Contact support.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken(user._id);
    res.json({
      success: true,
      token,
      user: publicEmployee(user),
    });
  } catch (error) {
    console.error('loginEmployee error:', error);
    res.status(500).json({ success: false, message: error.message || 'Login failed' });
  }
};

// Get current employee profile
export const getEmployeeMe = async (req, res) => {
  res.json({ success: true, data: publicEmployee(req.user) });
};

// Update employee profile
export const updateEmployeeProfile = async (req, res) => {
  try {
    // ── Password change flow ───────────────────────────────────────────────
    if (req.body.newPassword) {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword)
        return res.status(400).json({ success: false, message: 'Current password is required' });
      if (newPassword.length < 6)
        return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });

      // Re-fetch user with password field (select: false by default)
      const userWithPwd = await User.findById(req.user._id).select('+password');
      if (!userWithPwd)
        return res.status(404).json({ success: false, message: 'User not found' });

      const isMatch = await userWithPwd.comparePassword(currentPassword);
      if (!isMatch)
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });

      userWithPwd.password = newPassword; // pre-save hook will hash it
      await userWithPwd.save();
      return res.json({ success: true, message: 'Password changed successfully' });
    }

    // ── Regular profile update ─────────────────────────────────────────────
    const allowedFields = [
      'name', 'fullName', 'email', 'mobileNumber', 'department', 'designation',
      'gender', 'gstNumber', 'panNumber', 'industry', 'address'
    ];

    for (const key of allowedFields) {
      if (req.body[key] !== undefined) {
        if (key === 'fullName') {
          req.user.name = req.body[key];
        } else if (key === 'email') {
          req.user.email = req.body[key]?.toLowerCase();
        } else if (key === 'mobileNumber') {
          req.user.mobile = req.body[key];
          req.user.mobileNumber = req.body[key];
        } else if (key === 'gstNumber' || key === 'panNumber') {
          req.user[key] = req.body[key]?.toUpperCase();
        } else {
          req.user[key] = req.body[key];
        }
      }
    }

    // Handle profile photo update
    if (req.file) {
      const newPhoto = `/uploads/employees/${req.file.filename}`;
      // Delete old photo if exists
      if (req.user.photo) {
        const oldPath = path.join(__dirname, '../', req.user.photo);
        if (fs.existsSync(oldPath)) {
          fs.unlinkSync(oldPath);
        }
      }
      req.user.photo = newPhoto;
      req.user.profilePhoto = newPhoto;
    }

    await req.user.save();
    res.json({
      success: true,
      message: 'Profile updated successfully',
      data: publicEmployee(req.user),
    });
  } catch (error) {
    console.error('updateEmployeeProfile error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update profile' });
  }
};

// Logout employee
export const logoutEmployee = async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
};

export { upload };

// ── Admin: Get all registered employees (both 'employee' and 'delivery_logistics') ─────
export const getAllRegisteredEmployees = async (req, res) => {
  try {
    const { role, department, search, dateFrom, dateTo } = req.query;

    const filter = {
      role: { $in: ['employee', 'delivery_logistics'] },
    };

    // Filter by specific role if provided
    if (role && ['employee', 'delivery_logistics'].includes(role)) {
      filter.role = role;
    }

    // Filter by department
    if (department?.trim()) {
      filter.department = { $regex: department.trim(), $options: 'i' };
    }

    // Search by name, email or mobile
    if (search?.trim()) {
      filter.$or = [
        { name:         { $regex: search.trim(), $options: 'i' } },
        { email:        { $regex: search.trim(), $options: 'i' } },
        { mobile:       { $regex: search.trim(), $options: 'i' } },
        { mobileNumber: { $regex: search.trim(), $options: 'i' } },
        { designation:  { $regex: search.trim(), $options: 'i' } },
      ];
    }

    // Filter by registration date range
    if (dateFrom || dateTo) {
      filter.createdAt = {};
      if (dateFrom) filter.createdAt.$gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = end;
      }
    }

    const employees = await User.find(filter)
      .select('-password')
      .sort({ createdAt: -1 });

    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const data = employees.map(u => ({
      id:           u._id,
      employeeId:   `EMP-${String(u._id).slice(-6).toUpperCase()}`,
      name:         u.name,
      email:        u.email,
      mobile:       u.mobileNumber || u.mobile || '',
      role:         u.role,
      department:   u.department || '',
      designation:  u.designation || '',
      gender:       u.gender || '',
      joiningDate:  u.joiningDate || null,
      address:      u.address || '',
      gstNumber:    u.gstNumber || '',
      panNumber:    u.panNumber || '',
      industry:     u.industry || '',
      isActive:     u.isActive,
      isVerified:   u.isVerified,
      profilePhoto: u.photo || u.profilePhoto
        ? (u.photo || u.profilePhoto).startsWith('http')
          ? (u.photo || u.profilePhoto)
          : `${baseUrl}${u.photo || u.profilePhoto}`
        : '',
      createdAt:    u.createdAt,
      updatedAt:    u.updatedAt,
    }));

    res.json({ success: true, total: data.length, data });
  } catch (error) {
    console.error('getAllRegisteredEmployees error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch employees' });
  }
};
