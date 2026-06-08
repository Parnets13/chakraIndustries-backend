import express from 'express';
const router = express.Router();

// Store OTPs temporarily (use Redis in production)
const otpStore = new Map();

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

    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a valid 10-digit mobile number'
      });
    }

    // Generate OTP
    const otp = generateOTP();
    
    // Store OTP with 5 minutes expiry
    otpStore.set(mobile, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000
    });

    // TODO: Send OTP via SMS
    console.log(`📱 OTP for ${mobile}: ${otp}`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully',
      // For development only
      otp: process.env.NODE_ENV === 'development' ? otp : undefined
    });
  } catch (error) {
    console.error('Send OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send OTP'
    });
  }
});

// @route   POST /api/dealer/auth/verify-otp
// @desc    Verify OTP and login
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    // Check OTP
    const storedData = otpStore.get(mobile);

    if (!storedData) {
      return res.status(400).json({
        success: false,
        message: 'OTP expired or invalid'
      });
    }

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(mobile);
      return res.status(400).json({
        success: false,
        message: 'OTP has expired'
      });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP'
      });
    }

    // Clear OTP
    otpStore.delete(mobile);

    // Generate token (simplified for now)
    const token = `dealer_token_${mobile}_${Date.now()}`;

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      dealer: {
        mobile,
        name: 'Demo Dealer',
        dealerCode: 'DL-001',
        zone: 'South'
      }
    });
  } catch (error) {
    console.error('Verify OTP Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to verify OTP'
    });
  }
});

export default router;
