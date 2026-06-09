import express from 'express';
import User from '../../models/User.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Store OTPs temporarily (use Redis in production)
const otpStore = new Map();

// Authorized dealer numbers
const AUTHORIZED_DEALERS = {
  '9305241794': {
    name: 'Rajan Mehta',
    dealerCode: 'SCI-DLR-2041',
    zone: 'South',
    email: 'rajan.mehta@gmail.com',
    role: 'dealer'
  },
  '9999999999': {
    name: 'Test Dealer',
    dealerCode: 'SCI-DLR-0000',
    zone: 'Central',
    email: 'test@chakrainindustries.com',
    role: 'dealer'
  },
  '8888888888': {
    name: 'Demo Dealer',
    dealerCode: 'SCI-DLR-8888',
    zone: 'North',
    email: 'demo@chakrainindustries.com',
    role: 'dealer'
  }
};

// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// @route   POST /api/dealer/auth/send-otp
// @desc    Send OTP to dealer mobile
// @access  Public
router.post('/send-otp', async (req, res) => {
  try {
    const { mobile } = req.body;

    console.log(`📱 Send OTP request received for: ${mobile}`);

    // Validate mobile number
    if (!mobile) {
      console.log('❌ No mobile number provided');
      return res.status(400).json({
        success: false,
        message: 'Please provide a mobile number'
      });
    }

    // Remove any spaces or special characters
    const cleanMobile = mobile.toString().trim().replace(/\D/g, '');

    if (cleanMobile.length !== 10) {
      console.log(`❌ Invalid mobile length: ${cleanMobile.length}`);
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit mobile number'
      });
    }

    // Check if dealer is authorized
    if (!AUTHORIZED_DEALERS[cleanMobile]) {
      console.log(`❌ Unauthorized dealer: ${cleanMobile}`);
      console.log('Available dealers:', Object.keys(AUTHORIZED_DEALERS));
      return res.status(403).json({
        success: false,
        message: 'Unauthorized dealer. Please contact Sri Chakra Industries for dealer registration.'
      });
    }

    console.log(`✅ Authorized dealer found: ${AUTHORIZED_DEALERS[cleanMobile].name}`);

    // Generate OTP
    const otp = generateOTP();
    
    // Store OTP with 5 minutes expiry
    otpStore.set(cleanMobile, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      attempts: 0
    });

    // Log OTP in console for development
    console.log('='.repeat(60));
    console.log(`🔐 OTP GENERATED FOR ${cleanMobile}`);
    console.log(`📱 Dealer: ${AUTHORIZED_DEALERS[cleanMobile].name}`);
    console.log(`🔢 OTP: ${otp}`);
    console.log(`⏰ Expires at: ${new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString()}`);
    console.log('='.repeat(60));

    // TODO: Send OTP via SMS service (Twilio, MSG91, etc.)

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your registered mobile number',
      // Always send OTP in development mode for testing
      otp: otp, // Remove in production or check NODE_ENV
      dealer: {
        name: AUTHORIZED_DEALERS[cleanMobile].name,
        dealerCode: AUTHORIZED_DEALERS[cleanMobile].dealerCode
      }
    });
  } catch (error) {
    console.error('❌ Send OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP. Please try again.'
    });
  }
});

// @route   POST /api/dealer/auth/verify-otp
// @desc    Verify OTP and login
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    console.log(`🔐 Verify OTP request for: ${mobile}, OTP: ${otp}`);

    // Validate input
    if (!mobile || !otp) {
      console.log('❌ Missing mobile or OTP');
      return res.status(400).json({
        success: false,
        message: 'Please provide mobile number and OTP'
      });
    }

    // Clean mobile number
    const cleanMobile = mobile.toString().trim().replace(/\D/g, '');
    const cleanOTP = otp.toString().trim();

    // Check if dealer is authorized
    if (!AUTHORIZED_DEALERS[cleanMobile]) {
      console.log(`❌ Unauthorized dealer: ${cleanMobile}`);
      return res.status(403).json({
        success: false,
        message: 'Unauthorized dealer'
      });
    }

    // Check OTP
    const storedData = otpStore.get(cleanMobile);

    // Development/Master OTP check
    const isMasterOTP = cleanOTP === '123456';

    if (!storedData && !isMasterOTP) {
      console.log(`❌ No OTP found for: ${cleanMobile}`);
      return res.status(400).json({
        success: false,
        message: 'OTP expired or not found. Please request a new OTP.'
      });
    }

    if (storedData) {
      console.log(`📝 Stored OTP: ${storedData.otp}, Provided OTP: ${cleanOTP}`);

      // Check expiry
      if (Date.now() > storedData.expiresAt && !isMasterOTP) {
        otpStore.delete(cleanMobile);
        console.log(`❌ OTP expired for: ${cleanMobile}`);
        return res.status(400).json({
          success: false,
          message: 'OTP has expired. Please request a new OTP.'
        });
      }

      // Verify OTP
      if (storedData.otp !== cleanOTP && !isMasterOTP) {
        console.log(`❌ Invalid OTP for: ${cleanMobile}`);
        // Increment attempts
        storedData.attempts = (storedData.attempts || 0) + 1;
        
        if (storedData.attempts >= 3) {
          otpStore.delete(cleanMobile);
          return res.status(400).json({
            success: false,
            message: 'Too many failed attempts. Please request a new OTP.'
          });
        }
        
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP. Please check and try again.',
          attemptsLeft: 3 - storedData.attempts
        });
      }
    } else if (!isMasterOTP) {
      // This case should be covered by the first if, but just in case
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP request.'
      });
    }

    // OTP is correct - clear it
    otpStore.delete(cleanMobile);
    console.log(`✅ OTP verified successfully for: ${cleanMobile}`);

    // Get dealer info
    const dealerInfo = AUTHORIZED_DEALERS[cleanMobile];

    // Find or create dealer user in database
    let dealer = await User.findOne({ mobile: cleanMobile });
    
    if (!dealer) {
      console.log(`📝 Creating new dealer user: ${cleanMobile}`);
      dealer = await User.create({
        mobile: cleanMobile,
        name: dealerInfo.name,
        email: dealerInfo.email,
        role: 'dealer',
        dealerCode: dealerInfo.dealerCode,
        zone: dealerInfo.zone,
        isActive: true,
        isVerified: true
      });
      console.log(`✅ Dealer created with ID: ${dealer._id}`);
    } else {
      console.log(`✅ Existing dealer found with ID: ${dealer._id}`);
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        id: dealer._id, 
        mobile: dealer.mobile,
        role: dealer.role,
        dealerCode: dealer.dealerCode
      },
      process.env.JWT_SECRET || 'chakra_dealer_secret_2026',
      { expiresIn: '30d' }
    );

    console.log('='.repeat(60));
    console.log(`✅ LOGIN SUCCESSFUL`);
    console.log(`📱 Mobile: ${cleanMobile}`);
    console.log(`👤 Name: ${dealer.name}`);
    console.log(`🏢 Dealer Code: ${dealer.dealerCode}`);
    console.log(`🎫 Token Generated`);
    console.log('='.repeat(60));

    res.status(200).json({
      success: true,
      message: 'Login successful! Welcome to Sri Chakra Dealer App.',
      token,
      dealer: {
        id: dealer._id,
        mobile: dealer.mobile,
        name: dealer.name,
        email: dealer.email,
        dealerCode: dealer.dealerCode,
        zone: dealer.zone,
        role: dealer.role
      }
    });
  } catch (error) {
    console.error('❌ Verify OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP. Please try again.'
    });
  }
});

// @route   GET /api/dealer/auth/me
// @desc    Get current dealer info
// @access  Private
router.get('/me', async (req, res) => {
  try {
    // Get token from header
    const token = req.headers.authorization?.replace('Bearer ', '');
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'No authentication token provided'
      });
    }

    // Verify token
    const decoded = jwt.verify(
      token, 
      process.env.JWT_SECRET || 'chakra_dealer_secret_2026'
    );

    // Get dealer from database
    const dealer = await User.findById(decoded.id).select('-password');

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
    console.error('Get Me Error:', error);
    res.status(401).json({
      success: false,
      message: 'Invalid or expired token'
    });
  }
});

// @route   POST /api/dealer/auth/logout
// @desc    Logout dealer
// @access  Private
router.post('/logout', async (req, res) => {
  try {
    // In a real app, you might want to blacklist the token
    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout Error:', error);
    res.status(500).json({
      success: false,
      message: 'Logout failed'
    });
  }
});

export default router;
