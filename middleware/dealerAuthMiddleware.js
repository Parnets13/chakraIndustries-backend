import jwt from 'jsonwebtoken';
import Dealer from '../models/Dealer.js';
import User from '../models/User.js';

export const protectDealer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let dealer;
    
    if (decoded.type === 'dealer') {
      // Using Dealer model
      dealer = await Dealer.findById(decoded.id);
      if (!dealer || !dealer.isActive) {
        return res.status(401).json({ success: false, message: 'Dealer not found or inactive' });
      }
    } else if (decoded.role === 'dealer') {
      // Using User model
      dealer = await User.findById(decoded.id);
      if (!dealer || !dealer.isActive) {
        return res.status(401).json({ success: false, message: 'Dealer not found or inactive' });
      }
      // Normalize dealer fields to match Dealer model
      dealer = {
        ...dealer.toObject(),
        name: dealer.name,
        businessName: dealer.name,
        mobile: dealer.mobile,
        isActive: dealer.isActive,
      };
    } else {
      return res.status(401).json({ success: false, message: 'Invalid dealer token' });
    }

    req.dealer = dealer;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};
