import Vendor from '../models/Vendor.js';

// Auto-generate vendor ID like V-001, V-002...
const generateVendorId = async () => {
  const last = await Vendor.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'V-001';
  const num = parseInt(last.vendorId.split('-')[1] || '0') + 1;
  return `V-${String(num).padStart(3, '0')}`;
};

// POST /api/vendors
export const createVendor = async (req, res) => {
  try {
    const vendorId = await generateVendorId();
    const vendor = await Vendor.create({ ...req.body, vendorId });
    res.status(201).json({ success: true, data: vendor });
  } catch (err) {
    // Extract validation errors from Mongoose
    const message = err.message || 'Failed to create vendor';
    res.status(400).json({ success: false, message });
  }
};

// GET /api/vendors
export const getAllVendors = async (req, res) => {
  try {
    const { search, category, status } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { vendorId: { $regex: search, $options: 'i' } },
        { contactPerson: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }
    const vendors = await Vendor.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vendors/stats
export const getVendorStats = async (req, res) => {
  try {
    const total = await Vendor.countDocuments();
    const active = await Vendor.countDocuments({ status: 'Active' });
    const inactive = await Vendor.countDocuments({ status: 'Inactive' });
    const blacklisted = await Vendor.countDocuments({ status: 'Blacklisted' });
    res.json({ success: true, data: { total, active, inactive, blacklisted } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vendors/status/:status
export const getVendorsByStatus = async (req, res) => {
  try {
    const vendors = await Vendor.find({ status: req.params.status });
    res.json({ success: true, data: vendors });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vendors/:id
export const getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/vendors/:id
export const updateVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, data: vendor });
  } catch (err) {
    // Extract validation errors from Mongoose
    const message = err.message || 'Failed to update vendor';
    res.status(400).json({ success: false, message });
  }
};

// DELETE /api/vendors/:id
export const deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, message: 'Vendor deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// Vendor Price Mapping
// ══════════════════════════════════════════════════════════════════════════════
import VendorPrice from '../models/VendorPrice.js';

// GET /api/vendors/:id/prices — all prices for a vendor
export const getVendorPrices = async (req, res) => {
  try {
    const prices = await VendorPrice.find({ vendor: req.params.id }).sort({ productName: 1 });
    res.json({ success: true, data: prices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/vendors/:id/prices — add a price entry
export const addVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.create({ ...req.body, vendor: req.params.id });
    res.status(201).json({ success: true, data: price });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/vendors/:id/prices/:priceId — update a price entry
export const updateVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.findByIdAndUpdate(req.params.priceId, req.body, { new: true, runValidators: true });
    if (!price) return res.status(404).json({ success: false, message: 'Price entry not found' });
    res.json({ success: true, data: price });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/vendors/:id/prices/:priceId — delete a price entry
export const deleteVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.findByIdAndDelete(req.params.priceId);
    if (!price) return res.status(404).json({ success: false, message: 'Price entry not found' });
    res.json({ success: true, message: 'Price entry deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/vendors/prices/product?productCode=SKU-1042 — compare prices across vendors
export const getPricesByProduct = async (req, res) => {
  try {
    const { productCode, productName } = req.query;
    const filter = {};
    if (productCode) filter.productCode = productCode;
    if (productName) filter.productName = { $regex: productName, $options: 'i' };
    const prices = await VendorPrice.find(filter).populate('vendor', 'companyName vendorId rating').sort({ unitPrice: 1 });
    res.json({ success: true, data: prices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
