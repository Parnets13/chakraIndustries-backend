import jwt from 'jsonwebtoken';
import User from '../models/User.js';

export const protectEmployee = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'employee') {
      return res.status(401).json({ success: false, message: 'Invalid employee token' });
    }

    const user = await User.findById(decoded.id).select('+password');
    if (!user || !user.isActive) {
      return res.status(401).json({ success: false, message: 'Employee not found or inactive' });
    }

    if (!['employee', 'delivery_logistics'].includes(user.role)) {
      return res.status(403).json({ success: false, message: 'Not an employee account' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};
