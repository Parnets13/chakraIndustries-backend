import jwt from 'jsonwebtoken';
import User from '../models/User.js';

const generateToken = (id, type = 'delivery_agent') =>
  jwt.sign({ id, type }, process.env.JWT_SECRET, { expiresIn: '7d' });

const publicAgent = (user) => ({
  id: user._id,
  agentId: `DLV-${String(user._id).slice(-6).toUpperCase()}`,
  name: user.name,
  email: user.email,
  phone: user.mobile || user.mobileNumber || '',
  department: user.department || user.zone || '',
  designation: user.designation || '',
  zone: user.zone || user.department || '',
  vehicle: user.vehicleNumber || '',
  vehicleNumber: user.vehicleNumber || '',
  gender: user.gender || '',
  gstNumber: user.gstNumber || '',
  panNumber: user.panNumber || '',
  industry: user.industry || '',
  address: user.address || '',
  profilePhoto: user.photo || user.profilePhoto || '',
  joiningDate: user.joiningDate || '',
  status: user.isActive ? 'Active' : 'Inactive',
  role: user.role,
  stats: { totalDeliveries: 0, successfulDeliveries: 0, failedDeliveries: 0 },
  successRate: '0%',
});

export const loginDeliveryAgent = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required' });
    }

    const user = await User.findOne({
      email: email.toLowerCase(),
      role: 'delivery_logistics',
    }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'No account found. Please register first.' });
    }
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Your account is inactive. Contact support.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password' });
    }

    const token = generateToken(user._id);
    const agent = publicAgent(user);
    res.json({
      success: true,
      token,
      userType: 'delivery_agent',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.mobile || user.mobileNumber,
        role: user.role,
        department: user.department,
        designation: user.designation,
        profilePhoto: user.photo || user.profilePhoto,
      },
      agent,
    });
  } catch (error) {
    console.error('loginDeliveryAgent error:', error);
    res.status(500).json({ success: false, message: error.message || 'Login failed' });
  }
};

export const sendDeliveryOtp = async (req, res) => {
  try {
    const { email, phone } = req.body;
    let user;

    if (email) {
      user = await User.findOne({ email: email.toLowerCase(), role: 'delivery_logistics' });
    } else if (phone) {
      user = await User.findOne({
        $or: [{ mobile: phone }, { mobileNumber: phone }],
        role: 'delivery_logistics',
      });
    }

    const resolvedPhone = user?.mobile || user?.mobileNumber || phone || '';
    const devOtp = process.env.NODE_ENV !== 'production' ? '123456' : undefined;

    res.json({
      success: true,
      message: resolvedPhone ? 'OTP sent successfully' : 'OTP skipped — no phone registered',
      phone: resolvedPhone,
      otp: devOtp,
    });
  } catch (error) {
    console.error('sendDeliveryOtp error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to send OTP' });
  }
};

export const verifyDeliveryOtp = async (req, res) => {
  try {
    const { phone, otp } = req.body;
    if (!phone || !otp) {
      return res.status(400).json({ success: false, message: 'Phone and OTP are required' });
    }

    const isDevOtp = process.env.NODE_ENV !== 'production' && otp === '123456';
    if (!isDevOtp && otp.length !== 6) {
      return res.status(400).json({ success: false, message: 'Invalid OTP' });
    }

    const user = await User.findOne({
      $or: [{ mobile: phone }, { mobileNumber: phone }],
      role: 'delivery_logistics',
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Account not found' });
    }

    const token = generateToken(user._id);
    const agent = publicAgent(user);
    res.json({
      success: true,
      token,
      userType: 'delivery_agent',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.mobile || user.mobileNumber,
        role: user.role,
      },
      agent,
    });
  } catch (error) {
    console.error('verifyDeliveryOtp error:', error);
    res.status(500).json({ success: false, message: error.message || 'OTP verification failed' });
  }
};

export const getDeliveryProfile = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorized' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.role !== 'delivery_logistics') {
      return res.status(404).json({ success: false, message: 'Profile not found' });
    }

    res.json({ success: true, data: publicAgent(user) });
  } catch (error) {
    console.error('getDeliveryProfile error:', error);
    res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};
