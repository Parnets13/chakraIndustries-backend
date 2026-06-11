import jwt from 'jsonwebtoken';
import Dealer from '../models/Dealer.js';

export const protectDealer = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Not authorized, no token' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.type !== 'dealer') {
      return res.status(401).json({ success: false, message: 'Invalid dealer token' });
    }

    const dealer = await Dealer.findById(decoded.id);
    if (!dealer || !dealer.isActive) {
      return res.status(401).json({ success: false, message: 'Dealer not found or inactive' });
    }

    req.dealer = dealer;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};
