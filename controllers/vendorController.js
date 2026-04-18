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
    res.status(400).json({ success: false, message: err.message });
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
    res.status(400).json({ success: false, message: err.message });
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
