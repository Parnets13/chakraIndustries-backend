import express from 'express';
import User from '../../models/User.js';
import Client from '../../models/Client.js';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { sendEmail, classifySMTPError } from '../../utils/emailService.js';

const router = express.Router();

// ─── Multer for dealer photo upload ──────────────────────────────────────────
const photoDir = path.join(process.cwd(), 'uploads', 'dealer-photos');
if (!fs.existsSync(photoDir)) fs.mkdirSync(photoDir, { recursive: true });

const photoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, photoDir),
  filename:    (_req, file, cb) => {
    const ext  = path.extname(file.originalname) || '.jpg';
    const name = `dealer_${Date.now()}${ext}`;
    cb(null, name);
  },
});
const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
}).single('photo');

// ─── In-memory OTP store (mobile → { otp, expiresAt, attempts }) ─────────────
const otpStore = new Map();

// ─── Auto-increment dealer code counter ──────────────────────────────────────
let dealerCounter = 2100; // starts from SCI-DLR-2100 for new self-registrations
const generateDealerCode = () => {
  dealerCounter += 1;
  return `SCI-DLR-${dealerCounter}`;
};

// @route   POST /api/dealer/auth/register
// @desc    Self-register a new dealer (pending admin approval)
// @access  Public
router.post('/register', async (req, res) => {
  try {
    const { name, mobile, email, address, city, state, pincode, photo } = req.body;

    console.log('📋 New dealer registration:', mobile, name);

    // ── Validate required fields ──
    if (!name || !mobile || !address || !city || !state || !pincode) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: name, mobile, address, city, state, pincode',
      });
    }

    const cleanMobile = String(mobile).trim().replace(/\D/g, '');
    if (cleanMobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Invalid mobile number' });
    }

    // ── Check if already registered ──
    const existing = await User.findOne({ mobile: cleanMobile });
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'A dealer with this mobile number is already registered. Please login.',
      });
    }

    // ── Create dealer ──
    const dealerCode = generateDealerCode();
    const dealer = await User.create({
      name:       name.trim(),
      mobile:     cleanMobile,
      email:      email ? email.trim().toLowerCase() : undefined,
      address:    address.trim(),
      city:       city.trim(),
      state:      state.trim(),
      pincode:    pincode.trim(),
      photo:      photo || undefined,      // base64 or URL from app
      role:       'dealer',
      dealerCode,
      status:     'pending',              // awaits admin approval
      isActive:   false,                  // activated on approval
      isVerified: false,
    });

    console.log(`✅ Dealer registered: ${dealer.name} (${dealerCode})`);

    // Send registration confirmation email (non-blocking — never fail registration if email fails)
    if (dealer.email) {
      const registrationDate = new Date(dealer.createdAt).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
      sendEmail({
        to: dealer.email,
        subject: 'Welcome to Sri Chakra Industries – Dealer Registration Successful',
        html: `
          <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;background:#ffffff;">
            <div style="background:#C8102E;padding:24px 24px 16px;border-radius:12px 12px 0 0;text-align:center;">
              <h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:900;letter-spacing:0.3px;">Sri Chakra Industries</h1>
              <p style="color:rgba(255,255,255,0.80);margin:6px 0 0;font-size:13px;">Dealer Support</p>
            </div>
            <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #eee;border-top:none;">
              <h2 style="color:#1A1A1A;font-size:18px;margin-top:0;">Dealer Registration Successful</h2>
              <p style="color:#444;line-height:1.6;">Dear <strong>${dealer.name}</strong>,</p>
              <p style="color:#444;line-height:1.6;">
                Congratulations! Your dealer registration with Sri Chakra Industries has been completed successfully.
              </p>
              <p style="color:#444;line-height:1.6;">Your dealer account is now active.</p>
              <div style="background:#fff;border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin:20px 0;">
                <h3 style="color:#1A1A1A;font-size:16px;margin-top:0;margin-bottom:16px;">Registration Details:</h3>
                <table style="width:100%;font-size:14px;color:#555;">
                  <tr><td style="padding:8px 0;"><strong>Dealer Name</strong></td><td>${dealer.name}</td></tr>
                  <tr><td style="padding:8px 0;"><strong>Dealer ID</strong></td><td>${dealer.dealerCode}</td></tr>
                  <tr><td style="padding:8px 0;"><strong>Mobile Number</strong></td><td>${dealer.mobile}</td></tr>
                  <tr><td style="padding:8px 0;"><strong>Email ID</strong></td><td>${dealer.email}</td></tr>
                  <tr><td style="padding:8px 0;"><strong>Registration Date</strong></td><td>${registrationDate}</td></tr>
                </table>
              </div>
              <p style="color:#444;line-height:1.6;">
                You can now log in to the Dealer App using your registered mobile number and verify your identity with OTP.
              </p>
              <p style="color:#444;line-height:1.6;">
                Thank you for becoming a valued dealer of Sri Chakra Industries. We look forward to building a successful business relationship with you.
              </p>
              <p style="color:#444;line-height:1.6;">
                If you have any questions, please contact our support team.
              </p>
              <p style="color:#888;font-size:12px;margin-top:24px;border-top:1px solid #eee;padding-top:12px;">
                Regards,<br>Sri Chakra Industries<br>Dealer Support Team
              </p>
            </div>
          </div>
        `,
        text: `Dear ${dealer.name},

Congratulations! Your dealer registration with Sri Chakra Industries has been completed successfully.

Your dealer account is now active.

Registration Details:

Dealer Name: ${dealer.name}
Dealer ID: ${dealer.dealerCode}
Mobile Number: ${dealer.mobile}
Email ID: ${dealer.email}
Registration Date: ${registrationDate}

You can now log in to the Dealer App using your registered mobile number and verify your identity with OTP.

Thank you for becoming a valued dealer of Sri Chakra Industries. We look forward to building a successful business relationship with you.

If you have any questions, please contact our support team.

Regards,
Sri Chakra Industries
Dealer Support Team`,
      }).catch(emailErr => {
        const { userMessage } = classifySMTPError(emailErr);
        console.warn('[authRoutes] Registration email failed (non-fatal):', userMessage);
      });
    }

    res.status(201).json({
      success: true,
      message: 'Registration successful! Admin will review and approve your account shortly.',
      dealer: {
        id:         dealer._id,
        _id:        dealer._id,
        name:       dealer.name,
        mobile:     dealer.mobile,
        email:      dealer.email      || '',
        dealerCode: dealer.dealerCode,
        status:     dealer.status,
        address:    dealer.address    || '',
        city:       dealer.city       || '',
        state:      dealer.state      || '',
        pincode:    dealer.pincode    || '',
        photo:      dealer.photo      || null,
        zone:       dealer.zone       || '',
        isActive:   dealer.isActive,
        isVerified: dealer.isVerified,
        createdAt:  dealer.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ Register Error:', error);
    // Duplicate key error
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue || {})[0] || 'field';
      return res.status(409).json({
        success: false,
        message: `A dealer with this ${field} already exists.`,
      });
    }
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
});




// Generate 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// @route   POST /api/dealer/auth/send-otp
// @desc    Send OTP to dealer mobile (database-backed — any registered dealer can login)
// @access  Public
router.post('/send-otp', async (req, res) => {
  try {
    const { mobile } = req.body;

    console.log(`📱 Send OTP request received for: ${mobile}`);

    if (!mobile) {
      return res.status(400).json({ success: false, message: 'Please provide a mobile number' });
    }

    const cleanMobile = mobile.toString().trim().replace(/\D/g, '');

    if (cleanMobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Please provide a valid 10-digit mobile number' });
    }

    // ── Look up dealer in database ──
    const dealer = await User.findOne({ mobile: cleanMobile, role: 'dealer' });

    if (!dealer) {
      return res.status(403).json({
        success: false,
        message: 'Mobile number not registered. Please register as a dealer first.',
      });
    }

    // ── Check approval status ──
    if (dealer.status === 'pending') {
      return res.status(403).json({
        success: false,
        message: 'Your account is pending admin approval. Please wait for approval before logging in.',
      });
    }

    if (dealer.status === 'rejected' || dealer.isActive === false) {
      return res.status(403).json({
        success: false,
        message: 'Your dealer account has been deactivated. Please contact Sri Chakra Industries.',
      });
    }

    // ── Generate & store OTP ──
    const otp = generateOTP();

    otpStore.set(cleanMobile, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
      attempts:  0,
    });

    console.log('='.repeat(60));
    console.log(`🔐 OTP GENERATED FOR ${cleanMobile}`);
    console.log(`📱 Dealer: ${dealer.name}`);
    console.log(`🔢 OTP: ${otp}`);
    console.log(`⏰ Expires: ${new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString()}`);
    console.log('='.repeat(60));

    // TODO: Send via SMS service (Twilio / MSG91)

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully to your registered mobile number',
      otp,   // Remove in production
      dealer: {
        name:       dealer.name,
        dealerCode: dealer.dealerCode,
      },
    });
  } catch (error) {
    console.error('❌ Send OTP Error:', error);
    res.status(500).json({ success: false, message: 'Failed to send OTP. Please try again.' });
  }
});

// @route   POST /api/dealer/auth/verify-otp
// @desc    Verify OTP and login
// @access  Public
router.post('/verify-otp', async (req, res) => {
  try {
    const { mobile, otp } = req.body;

    console.log(`🔐 Verify OTP request for: ${mobile}`);

    if (!mobile || !otp) {
      return res.status(400).json({ success: false, message: 'Please provide mobile number and OTP' });
    }

    const cleanMobile = mobile.toString().trim().replace(/\D/g, '');
    const cleanOTP    = otp.toString().trim();

    // ── OTP check ──
    const storedData   = otpStore.get(cleanMobile);
    const isMasterOTP  = cleanOTP === '123456'; // dev master OTP

    if (!storedData && !isMasterOTP) {
      return res.status(400).json({ success: false, message: 'OTP expired or not found. Please request a new OTP.' });
    }

    if (storedData && !isMasterOTP) {
      if (Date.now() > storedData.expiresAt) {
        otpStore.delete(cleanMobile);
        return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new OTP.' });
      }

      if (storedData.otp !== cleanOTP) {
        storedData.attempts = (storedData.attempts || 0) + 1;
        if (storedData.attempts >= 3) {
          otpStore.delete(cleanMobile);
          return res.status(400).json({ success: false, message: 'Too many failed attempts. Please request a new OTP.' });
        }
        return res.status(400).json({
          success: false,
          message: 'Invalid OTP. Please check and try again.',
          attemptsLeft: 3 - storedData.attempts,
        });
      }
    }

    // OTP verified — clear it
    otpStore.delete(cleanMobile);
    console.log(`✅ OTP verified for: ${cleanMobile}`);

    // ── Get dealer from database ──
    let dealer = await User.findOne({ mobile: cleanMobile, role: 'dealer' });

    if (!dealer) {
      return res.status(404).json({ success: false, message: 'Dealer account not found. Please register first.' });
    }

    // Link to client if not already linked
    try {
      const matchingClient = await Client.findOne({ phone: cleanMobile });
      if (matchingClient && (!dealer.clientId || dealer.clientId.toString() !== matchingClient._id.toString())) {
        dealer.clientId = matchingClient._id;
        await dealer.save();
        console.log(`🔗 Linked dealer to client: ${matchingClient.name}`);
      }
    } catch (_) { /* non-critical */ }

    // ── Generate JWT ──
    const token = jwt.sign(
      { id: dealer._id, mobile: dealer.mobile, role: dealer.role, dealerCode: dealer.dealerCode },
      process.env.JWT_SECRET || 'chakra_dealer_secret_2026',
      { expiresIn: '30d' }
    );

    console.log('='.repeat(60));
    console.log(`✅ LOGIN SUCCESSFUL — ${dealer.name} (${dealer.dealerCode})`);
    console.log('='.repeat(60));

    res.status(200).json({
      success: true,
      message: 'Login successful! Welcome to Sri Chakra Dealer App.',
      token,
      dealer: {
        id:         dealer._id,
        _id:        dealer._id,
        mobile:     dealer.mobile,
        name:       dealer.name,
        email:      dealer.email      || '',
        dealerCode: dealer.dealerCode || '',
        zone:       dealer.zone       || '',
        role:       dealer.role,
        address:    dealer.address    || '',
        city:       dealer.city       || '',
        state:      dealer.state      || '',
        pincode:    dealer.pincode    || '',
        photo:      dealer.photo      || null,
        status:     dealer.status     || '',
        isActive:   dealer.isActive,
        isVerified: dealer.isVerified,
        createdAt:  dealer.createdAt,
      },
    });
  } catch (error) {
    console.error('❌ Verify OTP Error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify OTP. Please try again.' });
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

// @route   PUT /api/dealer/auth/change-password
// @desc    Change dealer password
// @access  Private
router.put('/change-password', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'chakra_dealer_secret_2026');
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Current and new passwords are required' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters' });
    }

    const dealer = await User.findById(decoded.id).select('+password');
    if (!dealer) {
      return res.status(404).json({ success: false, message: 'Dealer not found' });
    }

    // If no password set yet, allow setting directly
    if (dealer.password) {
      const isMatch = await dealer.comparePassword(currentPassword);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Current password is incorrect' });
      }
    }

    dealer.password = newPassword;
    await dealer.save();

    res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change Password Error:', error);
    res.status(500).json({ success: false, message: 'Failed to change password' });
  }
});

export default router;
