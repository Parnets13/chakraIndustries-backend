import express from 'express';
import User from '../../models/User.js';
import SalesOrder from '../../models/SalesOrder.js';
import Invoice from '../../models/Invoice.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Middleware to verify dealer token
const verifyDealer = (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token provided'
      });
    }

    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'chakra_dealer_secret_2026'
    );

    req.dealerId = decoded.id;
    req.dealerCode = decoded.dealerCode;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
};

// @route   GET /api/dealer/profile
// @desc    Get dealer profile
// @access  Private
router.get('/', verifyDealer, async (req, res) => {
  try {
    const dealer = await User.findById(req.dealerId).select('-password');

    if (!dealer) {
      return res.status(404).json({
        success: false,
        message: 'Dealer not found'
      });
    }

    res.status(200).json({
      success: true,
      data: dealer
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch profile'
    });
  }
});

// @route   PUT /api/dealer/profile/update
// @desc    Update dealer profile
// @access  Private
router.put('/update', verifyDealer, async (req, res) => {
  try {
    const { name, email, address } = req.body;

    const dealer = await User.findByIdAndUpdate(
      req.dealerId,
      { name, email, address },
      { new: true, runValidators: true }
    ).select('-password');

    if (!dealer) {
      return res.status(404).json({
        success: false,
        message: 'Dealer not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: dealer
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile'
    });
  }
});

// @route   GET /api/dealer/profile/addresses
// @desc    Get dealer addresses
// @access  Private
router.get('/addresses', verifyDealer, async (req, res) => {
  try {
    const dealer = await User.findById(req.dealerId).select('addresses');

    if (!dealer) {
      return res.status(404).json({
        success: false,
        message: 'Dealer not found'
      });
    }

    // If no addresses, provide a default from the profile address field if it exists
    let addresses = dealer.addresses || [];
    if (addresses.length === 0) {
      const fullDealer = await User.findById(req.dealerId).select('address');
      if (fullDealer.address) {
        addresses = [{
          label: 'Default Office',
          address: fullDealer.address,
          isDefault: true
        }];
      }
    }

    res.status(200).json({
      success: true,
      data: addresses
    });
  } catch (error) {
    console.error('Get addresses error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch addresses'
    });
  }
});

// @route   POST /api/dealer/profile/addresses
// @desc    Add a new delivery address
// @access  Private
router.post('/addresses', verifyDealer, async (req, res) => {
  try {
    const { label, address, city, state, pincode, isDefault } = req.body;

    if (!address || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        message: 'Please provide complete address details'
      });
    }

    const dealer = await User.findById(req.dealerId);

    if (!dealer) {
      return res.status(404).json({
        success: false,
        message: 'Dealer not found'
      });
    }

    // If this is set as default, unset others
    if (isDefault) {
      dealer.addresses.forEach(addr => {
        addr.isDefault = false;
      });
    }

    dealer.addresses.push({
      label: label || 'Site Address',
      address,
      city,
      state,
      pincode,
      isDefault: isDefault || false
    });

    await dealer.save();

    res.status(201).json({
      success: true,
      message: 'Address added successfully',
      data: dealer.addresses
    });
  } catch (error) {
    console.error('Add address error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add address'
    });
  }
});

// @route   GET /api/dealer/profile/pincode/:pincode
// @desc    Lookup pincode for city and state
// @access  Private
router.get('/pincode/:pincode', verifyDealer, async (req, res) => {
  try {
    const { pincode } = req.params;
    
    // In a real scenario, use a postal service API or a database of pincodes
    // For now, we'll provide a mock implementation with common Indian city/state patterns
    // or try to match from existing warehouses/dealers
    
    const pincodeData = {
      '560001': { city: 'Bengaluru', state: 'Karnataka' },
      '560068': { city: 'Bengaluru', state: 'Karnataka' },
      '400001': { city: 'Mumbai', state: 'Maharashtra' },
      '110001': { city: 'Delhi', state: 'Delhi' },
      '600001': { city: 'Chennai', state: 'Tamil Nadu' },
      '700001': { city: 'Kolkata', state: 'West Bengal' },
      '500001': { city: 'Hyderabad', state: 'Telangana' },
    };

    if (pincodeData[pincode]) {
      return res.status(200).json({
        success: true,
        data: pincodeData[pincode]
      });
    }

    // Default response if not in mock
    res.status(200).json({
      success: true,
      data: {
        city: '',
        state: '',
        message: 'Pincode found, please enter city and state manually'
      }
    });
  } catch (error) {
    console.error('Pincode lookup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to lookup pincode'
    });
  }
});

// @route   GET /api/dealer/profile/dashboard
// @desc    Get dealer dashboard data
// @access  Private
router.get('/dashboard', verifyDealer, async (req, res) => {
  try {
    const dealer = await User.findById(req.dealerId).select('-password');

    if (!dealer) {
      return res.status(404).json({
        success: false,
        message: 'Dealer not found'
      });
    }

    // Get order statistics
    const totalOrders = await SalesOrder.countDocuments({ 
      customer: dealer.name 
    });

    const thisMonthStart = new Date();
    thisMonthStart.setDate(1);
    thisMonthStart.setHours(0, 0, 0, 0);

    const monthOrders = await SalesOrder.countDocuments({
      customer: dealer.name,
      createdAt: { $gte: thisMonthStart }
    });

    const pendingOrders = await SalesOrder.countDocuments({
      customer: dealer.name,
      status: { $in: ['Pending', 'Processing'] }
    });

    const deliveredOrders = await SalesOrder.countDocuments({
      customer: dealer.name,
      status: 'Delivered'
    });

    // Get invoice statistics
    const pendingInvoices = await Invoice.countDocuments({
      partyName: dealer.name,
      paymentStatus: { $in: ['Pending', 'Partial'] }
    });

    // Calculate outstanding amount
    const outstandingAgg = await Invoice.aggregate([
      {
        $match: {
          partyName: dealer.name,
          paymentStatus: { $in: ['Pending', 'Partial'] }
        }
      },
      {
        $group: {
          _id: null,
          totalOutstanding: { $sum: '$remainingAmount' }
        }
      }
    ]);

    const outstandingAmount = outstandingAgg.length > 0 
      ? outstandingAgg[0].totalOutstanding 
      : 0;

    // Get monthly purchase amount
    const monthlyPurchaseAgg = await SalesOrder.aggregate([
      {
        $match: {
          customer: dealer.name,
          createdAt: { $gte: thisMonthStart }
        }
      },
      {
        $group: {
          _id: null,
          totalPurchase: { $sum: '$value' }
        }
      }
    ]);

    const monthlyPurchaseAmount = monthlyPurchaseAgg.length > 0 
      ? monthlyPurchaseAgg[0].totalPurchase 
      : 0;

    // Credit limit calculation
    const creditLimit = dealer.creditLimit || 500000;
    const usedCredit = outstandingAmount;
    const availableCredit = creditLimit - usedCredit;

    // Get recent orders
    const recentOrders = await SalesOrder.find({ 
      customer: dealer.name 
    })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('orderId status value createdAt')
      .lean();

    res.status(200).json({
      success: true,
      data: {
        dealer: {
          name: dealer.name,
          dealerCode: dealer.dealerCode || 'SCI-DLR-2041',
          zone: dealer.zone || 'South',
          mobile: dealer.mobile,
          email: dealer.email,
          creditLimit,
          usedCredit: Math.round(usedCredit),
          outstandingAmount: Math.round(outstandingAmount),
          availableCredit: Math.round(availableCredit)
        },
        stats: {
          totalOrders,
          monthOrders,
          pendingOrders,
          deliveredOrders,
          monthlyPurchaseAmount: Math.round(monthlyPurchaseAmount),
          pendingInvoices,
          unreadNotifications: 0
        },
        recentOrders: recentOrders.map(order => ({
          orderId: order.orderId,
          status: order.status,
          amount: order.value,
          date: order.createdAt
        }))
      }
    });
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data'
    });
  }
});

export default router;
