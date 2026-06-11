import jwt from 'jsonwebtoken';
import Dealer from '../models/Dealer.js';
import Client from '../models/Client.js';

const OTP_TTL_MS = 5 * 60 * 1000;

const normalizeMobile = (mobile = '') => String(mobile).replace(/\D/g, '').slice(-10);
const normalizeGstin = (gstin = '') => String(gstin).toUpperCase().replace(/\s/g, '');

const generateToken = (id) =>
  jwt.sign({ id, type: 'dealer' }, process.env.JWT_SECRET, { expiresIn: '7d' });

const publicDealer = (dealer) => ({
  id: dealer._id,
  name: dealer.name,
  mobile: dealer.mobile,
  dealerCode: dealer.dealerCode,
  email: dealer.email,
  businessName: dealer.businessName,
  contactPerson: dealer.contactPerson,
  zone: dealer.zone,
  address: dealer.address,
  city: dealer.city,
  state: dealer.state,
  pincode: dealer.pincode,
  gstin: dealer.gstin,
  panNumber: dealer.panNumber,
  creditLimit: dealer.creditLimit,
  outstandingAmount: dealer.outstandingAmount,
  role: 'dealer',
});

const generateClientId = async () => {
  const last = await Client.findOne({ clientId: /^DLR-/ }, {}, { sort: { createdAt: -1 } });
  const next = last?.clientId ? parseInt(last.clientId.split('-')[1] || '0', 10) + 1 : 1;
  return `DLR-${String(next).padStart(4, '0')}`;
};

const syncDealerToClient = async (dealer) => {
  const city = dealer.city || 'Not Provided';
  const contact = dealer.contactPerson || dealer.name;
  const clientPayload = {
    name: dealer.businessName || dealer.name,
    contact,
    phone: dealer.mobile,
    email: dealer.email || '',
    city,
    state: dealer.state || '',
    pincode: dealer.pincode || '',
    category: 'Distributor',
    creditLimit: dealer.creditLimit || 0,
    outstanding: dealer.outstandingAmount || 0,
    gstNumber: dealer.gstin || '',
    address: dealer.address || '',
    remarks: 'Registered from dealer mobile app',
    status: dealer.isActive ? 'Active' : 'Inactive',
  };

  let client = dealer.erpClientId ? await Client.findById(dealer.erpClientId) : null;
  if (!client) {
    client = await Client.findOne({ phone: dealer.mobile });
  }

  if (client) {
    Object.assign(client, clientPayload);
    await client.save();
  } else {
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
};

export const registerDealer = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile);
    const name = String(req.body.name || '').trim();
    const businessName = String(req.body.businessName || '').trim();

    if (!name || !mobile) {
      return res.status(400).json({ success: false, message: 'Name and mobile number are required' });
    }
    if (mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Mobile number must be 10 digits' });
    }

    const existing = await Dealer.findOne({ mobile });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Dealer already registered. Please login with OTP.' });
    }

    const dealer = await Dealer.create({
      name,
      mobile,
      businessName,
      contactPerson: req.body.contactPerson || name,
      email: req.body.email || '',
      zone: req.body.zone || '',
      address: req.body.address || '',
      city: req.body.city || '',
      state: req.body.state || '',
      pincode: String(req.body.pincode || '').replace(/\D/g, ''),
      gstin: normalizeGstin(req.body.gstin || req.body.gstNumber),
      panNumber: req.body.panNumber || '',
    });

    const client = await syncDealerToClient(dealer);

    res.status(201).json({
      success: true,
      message: 'Dealer registered and synced with ERP successfully',
      dealer: publicDealer(dealer),
      erpClient: { id: client._id, clientId: client.clientId },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to register dealer' });
  }
};

export const sendDealerOtp = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile);
    if (mobile.length !== 10) {
      return res.status(400).json({ success: false, message: 'Mobile number must be 10 digits' });
    }

    const dealer = await Dealer.findOne({ mobile }).select('+otp +otpExpiry');
    if (!dealer || !dealer.isActive) {
      return res.status(404).json({ success: false, message: 'Dealer not registered or inactive' });
    }

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    dealer.otp = otp;
    dealer.otpExpiry = new Date(Date.now() + OTP_TTL_MS);
    await dealer.save();

    res.json({
      success: true,
      message: 'OTP sent successfully',
      otp: process.env.NODE_ENV === 'production' ? undefined : otp,
      dealer: publicDealer(dealer),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to send OTP' });
  }
};

export const verifyDealerOtp = async (req, res) => {
  try {
    const mobile = normalizeMobile(req.body.mobile);
    const otp = String(req.body.otp || '').trim();

    const dealer = await Dealer.findOne({ mobile }).select('+otp +otpExpiry');
    if (!dealer || !dealer.isActive) {
      return res.status(404).json({ success: false, message: 'Dealer not registered or inactive' });
    }
    
    // Check master OTP (for testing/debugging)
    const isMasterOtp = otp === '123456';
    if (!isMasterOtp && (!dealer.otp || dealer.otp !== otp || !dealer.otpExpiry || dealer.otpExpiry < new Date())) {
      return res.status(401).json({ success: false, message: 'Invalid or expired OTP' });
    }

    dealer.otp = undefined;
    dealer.otpExpiry = undefined;
    await dealer.save();
    await syncDealerToClient(dealer);

    const token = generateToken(dealer._id);
    res.json({ success: true, token, dealer: publicDealer(dealer) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message || 'Failed to verify OTP' });
  }
};

export const getDealerMe = async (req, res) => {
  res.json({ success: true, dealer: publicDealer(req.dealer) });
};

export const logoutDealer = async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully' });
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
    // Get dealer's orders from ERP (clientId links dealer to ERP client)
    const filter = dealer.erpClientId ? { customer: dealer.erpClientId } : {};
    
    const allOrders = await SalesOrder.find(filter).sort({ createdAt: -1 });
    const monthOrders = await SalesOrder.find({
      ...filter,
      createdAt: { $gte: startOfMonth }
    });

    // Calculate stats
    const totalOrders = allOrders.length;
    const pendingOrders = allOrders.filter(o => ['Pending', 'Processing', 'Approved'].includes(o.status)).length;
    const approvedOrders = allOrders.filter(o => o.status === 'Approved').length;
    const dispatchedOrders = allOrders.filter(o => ['Shipped', 'In Transit'].includes(o.status)).length;
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
      status: o.status || 'Pending'
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
          pendingOrders,
          approvedOrders,
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
    res.json({
      success: true,
      data: {
        dealer: {
          ...publicDealer(dealer),
          usedCredit,
          availableCredit: Math.max(creditLimit - usedCredit, 0),
        },
        stats: {
          totalOrders: 0,
          monthOrders: 0,
          pendingOrders: 0,
          approvedOrders: 0,
          dispatchedOrders: 0,
          deliveredOrders: 0,
          monthlyPurchaseAmount: 0,
          pendingInvoices: 0,
        },
        recentOrders: [],
      },
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
