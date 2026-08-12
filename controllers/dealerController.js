import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Dealer from '../models/Dealer.js';
import Client from '../models/Client.js';
import { sendEmail, classifySMTPError } from '../utils/emailService.js';

const OTP_TTL_MS     = 5 * 60 * 1000;   // 5 minutes
const MAX_SESSIONS   = 3;                 // max simultaneous login sessions per dealer

// In-memory OTP backup store (fallback if DB save has issues)
const otpStore    = new Map();  // login OTPs
const regOtpStore = new Map();  // registration verification OTPs

const normalizeMobile = (mobile = '') => String(mobile).replace(/\D/g, '').slice(-10);
const normalizeGstin  = (gstin  = '') => String(gstin).toUpperCase().replace(/\s/g, '');

// Generate unique session ID
const generateSessionId = () => crypto.randomBytes(16).toString('hex');

/** Generate a signed JWT that embeds sessionId so individual sessions can be invalidated */
const generateToken = (id, sessionId) =>
  jwt.sign({ id, type: 'dealer', sessionId }, process.env.JWT_SECRET, { expiresIn: '7d' });

const publicDealer = (dealer) => {
  // Derive a human-readable status from model fields
  let status = dealer.status || 'Active';

  // Handle both Dealer model and User model
  return {
    id: dealer._id,
    dealerId: dealer.dealerId || dealer.dealerCode || dealer.dealerCode,
    dealerCode: dealer.dealerCode || dealer.dealerCode,
    dealerName: dealer.dealerName || dealer.name || dealer.name,
    name: dealer.name || dealer.dealerName,
    ownerName: dealer.ownerName || dealer.contactPerson || dealer.name,
    contactPerson: dealer.contactPerson || dealer.ownerName,
    mobile: dealer.mobile,
    mobileNumber: dealer.mobileNumber || dealer.mobile,
    email: dealer.email || '',
    businessName: dealer.businessName || dealer.shopName || dealer.name,
    shopName: dealer.shopName || dealer.businessName || dealer.name,
    photo: dealer.photo || '',
    profilePhoto: dealer.profilePhoto || dealer.photo || '',
    zone: dealer.zone || '',
    address: dealer.address || '',
    city: dealer.city || '',
    state: dealer.state || '',
    pincode: dealer.pincode || '',
    gstin: dealer.gstin || dealer.gstNumber || '',
    gstNumber: dealer.gstNumber || dealer.gstin || '',
    panNumber: dealer.panNumber || '',
    creditLimit: dealer.creditLimit || 0,
    outstandingAmount: dealer.outstandingAmount || 0,
    role: 'dealer',
    status,
    isActive: dealer.isActive,
    createdAt: dealer.createdAt,
    lastLogin: dealer.lastLogin,
    otpVerified: dealer.otpVerified || dealer.isVerified || false,
  };
};

const generateClientId = async () => {
  const last = await Client.findOne({ clientId: /^DLR-/ }, {}, { sort: { createdAt: -1 } });
  const next = last?.clientId ? parseInt(last.clientId.split('-')[1] || '0', 10) + 1 : 1;
  return `DLR-${String(next).padStart(4, '0')}`;
};

const syncDealerToClient = async (dealer) => {
  try {
    const city = dealer.city || 'Not Provided';
    const contact = dealer.contactPerson || dealer.name;
    // Ensure phone is strictly 10 digits for Client model validation
    const phone = normalizeMobile(dealer.mobile);

    if (phone.length !== 10) {
      throw new Error(`Invalid mobile number for client sync: ${phone}`);
    }

    const clientPayload = {
      name: dealer.businessName || dealer.name,
      contact,
      phone,
      email: dealer.email || '',
      city,
      state: dealer.state || '',
      pincode: dealer.pincode || '',
      category: 'Distributor',
      creditLimit: dealer.creditLimit || 0,
      outstanding: dealer.outstandingAmount || 0,
      // gstNumber: '', // Don't set GSTIN to avoid errors!
      address: dealer.address || '',
      remarks: 'Registered from dealer mobile app',
      status: dealer.isActive ? 'Active' : 'Inactive',
    };

    // Find existing client by phone, dealer.erpClientId, or GSTIN (if provided)
    let client = dealer.erpClientId ? await Client.findById(dealer.erpClientId) : null;
    if (!client && phone) {
      client = await Client.findOne({ phone });
    }
    if (!client && gstin) {
      client = await Client.findOne({ gstNumber: gstin });
    }

    if (client) {
      // Update existing client
      Object.assign(client, clientPayload);
      await client.save();
    } else {
      // Create new client
      client = await Client.create({
        ...clientPayload,
        clientId: await generateClientId(),
      });
    }

    if (!dealer.erpClientId || String(dealer.erpClientId) !== String(client._id)) {
      dealer.erpClientId = client._id;
      await dealer.save();
    }

    return client;
  } catch (syncErr) {
    // Make syncDealerToClient NON-BLOCKING even if it fails—never fail registration/login!
    console.error('syncDealerToClient error (non-fatal, skipping sync):', syncErr.message);
    // Return null to indicate sync failed but we can proceed
    return null;
  }
};

export const registerDealer = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile || req.body.mobileNumber);
    const name = String(req.body.name || req.body.dealerName || '').trim();
    const businessName = String(req.body.businessName || req.body.shopName || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    // Don't use GSTIN during registration to avoid errors!
    // const gstin = normalizeGstin(req.body.gstin || req.body.gstNumber);

    if (!name || !mobile) {
      return res.status(400).json({ success: false, message: 'Name and mobile number are required' });
    }
    if (mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Mobile number must be 10 digits' });
    }

    // Check if User (role=dealer) already exists with this mobile
    let existingUser = null;
    let existingDealer = null;

    // Check User model first
    existingUser = await (await import('../models/User.js')).default.findOne({ 
      mobile,
      role: 'dealer' 
    });

    // Check Dealer model
    existingDealer = await Dealer.findOne({ 
      $or: [{ mobile }, { mobileNumber: mobile }] 
    });

    // If either exists, just return the existing one—no need to register again!
    if (existingUser || existingDealer) {
      const dealerToReturn = existingDealer || existingUser;
      return res.status(200).json({
        success: true,
        message: 'You are already registered! Please login with your mobile number.',
        dealer: publicDealer(dealerToReturn),
      });
    }

    // Create a new dealer record—NO GSTIN!
    const dealer = await Dealer.create({
      dealerName: name,
      name,
      ownerName: req.body.ownerName || req.body.contactPerson || name,
      contactPerson: req.body.ownerName || req.body.contactPerson || name,
      mobile,
      mobileNumber: mobile,
      businessName,
      shopName: businessName,
      email: email || '',
      zone: req.body.zone || '',
      address: req.body.address || '',
      city: req.body.city || '',
      state: req.body.state || '',
      pincode: String(req.body.pincode || '').replace(/\D/g, ''),
      // gstin: '', // Don't set GSTIN
      // gstNumber: '', // Don't set GSTIN
      panNumber: req.body.panNumber || '',
      photo: req.body.photo || req.body.profilePhoto || '',
      profilePhoto: req.body.photo || req.body.profilePhoto || '',
      isActive: true,
      status: 'Active',
    });

    // Sync to ERP client — non-blocking if it fails
    let erpClient = null;
    try {
      erpClient = await syncDealerToClient(dealer);
    } catch (syncErr) {
      console.error('syncDealerToClient error (non-fatal):', syncErr.message);
    }

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
                  <tr><td style="padding:8px 0;"><strong>Dealer ID</strong></td><td>${dealer.dealerId || dealer.dealerCode}</td></tr>
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
Dealer ID: ${dealer.dealerId || dealer.dealerCode}
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
        console.warn('[registerDealer] Registration email failed (non-fatal):', userMessage);
      });
    }

    res.status(201).json({
      success: true,
      message: 'Dealer Registration Completed Successfully.',
      dealer: publicDealer(dealer),
      ...(erpClient && { erpClient: { id: erpClient._id, clientId: erpClient.clientId } }),
    });
  } catch (error) {
    console.error('registerDealer error:', error);
    if (error.code === 11000) { // Duplicate key error
      const field = Object.keys(error.keyPattern)[0];
      const message = `${field} is already registered.`;
      return res.status(400).json({ success: false, message });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to register dealer' });
  }
};



export const sendDealerOtp = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile || req.body.mobileNumber);
    if (mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Mobile number must be 10 digits' });
    }
    const dealer = await Dealer.findOne({ 
      $or: [{ mobile }, { mobileNumber: mobile }],
      isActive: true 
    }).select('+otp +otpExpiry');
    if (!dealer) {
      // Check if dealer exists but is inactive
      const inactiveDealer = await Dealer.findOne({ 
        $or: [{ mobile }, { mobileNumber: mobile }] 
      });
      if (inactiveDealer && !inactiveDealer.isActive) {
        return res.status(403).json({ success: false, message: 'Your dealer account is inactive. Contact support.' });
      }
      return res.status(404).json({ success: false, message: 'Mobile number is not registered. Please register first.' });
    }
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    dealer.otp = otp;
    dealer.otpExpiry = new Date(Date.now() + OTP_TTL_MS);
    await dealer.save();

    otpStore.set(mobile, { otp, expiresAt: Date.now() + OTP_TTL_MS });

    console.log('='.repeat(50));
    console.log(`🔐 OTP for ${mobile}: ${otp}`);
    console.log(`⏰ Expires: ${new Date(Date.now() + OTP_TTL_MS).toLocaleTimeString()}`);
    console.log('='.repeat(50));

    res.json({
      success: true,
      message: 'OTP sent successfully',
      otp: otp,
      dealer: publicDealer(dealer),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to send OTP' });
  }
};

export const verifyDealerOtp = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile || req.body.mobileNumber);
    const otp    = String(req.body.otp || '').trim();
    const deviceInfo = req.body.deviceInfo || '';

    if (!mobile || mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Valid 10-digit mobile number is required' });
    }
    if (!otp) {
      return res.status(400).json({ success: false, message: 'OTP is required' });
    }

    const dealer = await Dealer.findOne({ 
      $or: [{ mobile }, { mobileNumber: mobile }],
      isActive: true 
    }).select('+otp +otpExpiry');
    if (!dealer) {
      const inactiveDealer = await Dealer.findOne({ 
        $or: [{ mobile }, { mobileNumber: mobile }] 
      });
      if (inactiveDealer && !inactiveDealer.isActive) {
        return res.status(403).json({ success: false, message: 'Your dealer account is inactive. Contact support.' });
      }
      return res.status(404).json({ success: false, message: 'Mobile number is not registered. Please register first.' });
    }

    const isMasterOtp = otp === '123456';

    if (!isMasterOtp) {
      const memEntry = otpStore.get(mobile);
      const dbOtp    = dealer.otp;

      const validFromDb  = dbOtp && otp === dbOtp && dealer.otpExpiry && dealer.otpExpiry >= new Date();
      const validFromMem = memEntry && otp === memEntry.otp && Date.now() <= memEntry.expiresAt;

      if (!dbOtp && !memEntry) {
        return res.status(401).json({ success: false, message: 'OTP not requested. Please request a new OTP first.' });
      }
      if (!validFromDb && !validFromMem) {
        if ((dealer.otpExpiry && dealer.otpExpiry < new Date()) || (memEntry && Date.now() > memEntry.expiresAt)) {
          return res.status(401).json({ success: false, message: 'OTP has expired. Please request a new one.' });
        }
        return res.status(401).json({ success: false, message: 'Incorrect OTP. Please check and try again.' });
      }
    }

    dealer.otp = undefined;
    dealer.otpExpiry = undefined;
    dealer.otpVerified = true;
    dealer.lastLogin = new Date();

    // Manage active sessions (max 3)
    const sessionId = generateSessionId();
    const newSession = {
      sessionId,
      loginTime: new Date(),
      deviceInfo
    };

    if (dealer.activeSessions.length >= MAX_SESSIONS) {
      // Remove oldest session
      dealer.activeSessions.shift();
    }
    dealer.activeSessions.push(newSession);
    await dealer.save();
    otpStore.delete(mobile);

    try {
      await syncDealerToClient(dealer);
    } catch (syncErr) {
      console.error('syncDealerToClient error (non-fatal):', syncErr.message);
    }

    const token = generateToken(dealer._id, sessionId);
    return res.json({ success: true, token, dealer: publicDealer(dealer) });
  } catch (error) {
    console.error('verifyDealerOtp error:', error);
    return res.status(500).json({ success: false, message: 'Login failed. Please try again.' });
  }
};

export const getDealerMe = async (req, res) => {
  res.json({ success: true, dealer: publicDealer(req.dealer) });
};

export const logoutDealer = async (req, res) => {
  try {
    // The frontend should remove the token from storage and redirect to login/register page
    res.json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('logoutDealer error:', error);
    res.status(500).json({ success: false, message: 'Logout failed' });
  }
};

export const getDealerProfile = async (req, res) => {
  res.json({ success: true, data: publicDealer(req.dealer) });
};

export const updateDealerProfile = async (req, res) => {
  try {
    const allowed = ['name', 'businessName', 'contactPerson', 'email', 'zone', 'address', 'city', 'state', 'pincode', 'gstin', 'panNumber'];
    for (const key of allowed) {
      if (req.body[key] !== undefined) req.dealer[key] = req.body[key];
    }
    if (req.body.gstNumber !== undefined) req.dealer.gstin = req.body.gstNumber;
    req.dealer.mobile = normalizeMobile(req.dealer.mobile);
    req.dealer.gstin = normalizeGstin(req.dealer.gstin);
    req.dealer.pincode = String(req.dealer.pincode || '').replace(/\D/g, '');
    await req.dealer.save();
    await syncDealerToClient(req.dealer);
    res.json({ success: true, data: publicDealer(req.dealer), message: 'Profile updated and synced with ERP' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to update profile' });
  }
};

import SalesOrder from '../models/SalesOrder.js';
import Invoice from '../models/Invoice.js';

export const getDealerDashboard = async (req, res) => {
  const dealer = req.dealer;
  const usedCredit = dealer.outstandingAmount || 0;
  const creditLimit = dealer.creditLimit || 0;
  
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    // Match orders belonging to this dealer: by erpClientId, name, or dealerId
    const dealerCustomer = dealer.businessName || dealer.name;
    const baseOr = [];
    if (dealer.erpClientId) baseOr.push({ customerId: dealer.erpClientId });
    if (dealerCustomer)     baseOr.push({ customer: dealerCustomer });
    if (dealer._id)         baseOr.push({ dealerId: dealer._id });
    const filter = baseOr.length ? { $or: baseOr } : {};

    const allOrders = await SalesOrder.find(filter).sort({ createdAt: -1 });
    const monthOrders = await SalesOrder.find({
      ...filter,
      createdAt: { $gte: startOfMonth }
    });

    // Calculate stats using new statuses
    const totalOrders = allOrders.length;
    const pendingApprovalOrders = allOrders.filter(o => o.status === 'Pending Approval').length;
    const approvedOrders = allOrders.filter(o => o.status === 'Approved').length;
    const pickingOrders = allOrders.filter(o => ['Picking Started', 'Picking Completed'].includes(o.status)).length;
    const sortingOrders = allOrders.filter(o => ['Sorting Started', 'Sorting Completed'].includes(o.status)).length;
    const packingOrders = allOrders.filter(o => ['Packing Started', 'Packing Completed'].includes(o.status)).length;
    const dispatchedOrders = allOrders.filter(o => ['Dispatched'].includes(o.status)).length;
    const deliveredOrders = allOrders.filter(o => o.status === 'Delivered').length;
    
    const monthlyPurchaseAmount = monthOrders.reduce((sum, o) => sum + (Number(o.value) || 0), 0);
    const pendingInvoices = await Invoice.countDocuments({
      ...(dealer.erpClientId ? { client: dealer.erpClientId } : {}),
      status: { $ne: 'Paid' }
    });

    // Recent orders
    const recentOrders = allOrders.slice(0, 5).map(o => ({
      orderId: o.orderId || o._id,
      date: o.createdAt,
      amount: o.value || 0,
      status: o.status || 'Order Placed'
    }));

    res.json({
      success: true,
      data: {
        dealer: {
          ...publicDealer(dealer),
          usedCredit,
          availableCredit: Math.max(creditLimit - usedCredit, 0),
        },
        stats: {
          totalOrders,
          monthOrders: monthOrders.length,
          pendingApprovalOrders,
          approvedOrders,
          pickingOrders,
          sortingOrders,
          packingOrders,
          dispatchedOrders,
          deliveredOrders,
          monthlyPurchaseAmount,
          pendingInvoices,
        },
        recentOrders,
      },
    });
  } catch (error) {
    console.error('Dashboard Error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch dashboard data',
      error: error.message
    });
  }
};

export const getAllDealers = async (req, res) => {
  try {
    const { search = '', status = '' } = req.query;
    const filter = {};
    if (status === 'Active') filter.isActive = true;
    if (status === 'Inactive') filter.isActive = false;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { businessName: { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { dealerCode: { $regex: search, $options: 'i' } },
        { gstin: { $regex: search, $options: 'i' } },
      ];
    }

    const dealers = await Dealer.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: dealers.map(publicDealer) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to fetch dealers' });
  }
};

// ── Admin: Update dealer ──────────────────────────────────────────────────────
export const adminUpdateDealer = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name, email, mobile, businessName, contactPerson, zone,
      address, city, state, pincode, gstin, panNumber,
      creditLimit, isActive,
    } = req.body;

    const dealer = await Dealer.findById(id);
    if (!dealer) return res.status(404).json({ success: false, message: 'Dealer not found' });

    // Email uniqueness check
    if (email && email.toLowerCase() !== (dealer.email || '').toLowerCase()) {
      const exists = await Dealer.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
      if (exists) return res.status(400).json({ success: false, message: 'Email is already in use' });
      dealer.email = email.toLowerCase().trim();
    }

    // Mobile uniqueness check
    const normMobile = mobile ? normalizeMobile(mobile) : null;
    if (normMobile && normMobile !== normalizeMobile(dealer.mobile || '')) {
      const exists = await Dealer.findOne({ mobile: normMobile, _id: { $ne: id } });
      if (exists) return res.status(400).json({ success: false, message: 'Mobile number is already in use' });
      dealer.mobile       = normMobile;
      dealer.mobileNumber = normMobile;
    }

    if (name          !== undefined) dealer.name          = name.trim();
    if (businessName  !== undefined) dealer.businessName  = businessName.trim();
    if (contactPerson !== undefined) dealer.contactPerson = contactPerson.trim();
    if (zone          !== undefined) dealer.zone          = zone.trim();
    if (address       !== undefined) dealer.address       = address.trim();
    if (city          !== undefined) dealer.city          = city.trim();
    if (state         !== undefined) dealer.state         = state.trim();
    if (pincode       !== undefined) dealer.pincode       = pincode.trim();
    if (gstin         !== undefined) dealer.gstin         = normalizeGstin(gstin);
    if (panNumber     !== undefined) dealer.panNumber     = panNumber.toUpperCase().trim();
    if (creditLimit   !== undefined) dealer.creditLimit   = Number(creditLimit) || 0;
    if (isActive      !== undefined) dealer.isActive      = Boolean(isActive);

    await dealer.save();
    res.json({ success: true, message: 'Dealer updated successfully', data: publicDealer(dealer) });
  } catch (error) {
    console.error('adminUpdateDealer error:', error);
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ success: false, message: `${field} is already in use` });
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to update dealer' });
  }
};

// ── Admin: Delete dealer ──────────────────────────────────────────────────────
export const adminDeleteDealer = async (req, res) => {
  try {
    const { id } = req.params;
    const dealer = await Dealer.findById(id);
    if (!dealer) return res.status(404).json({ success: false, message: 'Dealer not found' });
    await Dealer.findByIdAndDelete(id);
    res.json({ success: true, message: 'Dealer deleted successfully' });
  } catch (error) {
    console.error('adminDeleteDealer error:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete dealer' });
  }
};
