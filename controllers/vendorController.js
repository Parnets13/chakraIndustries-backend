import Vendor from '../models/Vendor.js';
import VendorPrice from '../models/VendorPrice.js';

// ── helpers ──────────────────────────────────────────────────────────────────

const generateVendorId = async () => {
  const count = await Vendor.countDocuments();
  return `VND-${String(count + 1).padStart(4, '0')}`;
};

// ── Vendor CRUD ───────────────────────────────────────────────────────────────

// POST /api/vendors
export const createVendor = async (req, res) => {
  try {
    const vendorId = await generateVendorId();
    const vendor = await Vendor.create({ ...req.body, vendorId });
    res.status(201).json({ success: true, vendor });
  } catch (error) {
    if (error.code === 11000) {
      const field = Object.keys(error.keyValue)[0];
      return res.status(400).json({ success: false, message: `${field} already exists` });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// GET /api/vendors
export const getAllVendors = async (req, res) => {
  try {
    const { category, status, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (category) filter.category = category;
    if (status)   filter.status   = status;
    if (search) {
      filter.$or = [
        { companyName:    { $regex: search, $options: 'i' } },
        { vendorId:       { $regex: search, $options: 'i' } },
        { contactPerson:  { $regex: search, $options: 'i' } },
        { email:          { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Vendor.countDocuments(filter);
    const vendors = await Vendor.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({ success: true, total, page: Number(page), vendors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/vendors/stats
export const getVendorStats = async (req, res) => {
  try {
    const [statusStats, categoryStats] = await Promise.all([
      Vendor.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Vendor.aggregate([{ $group: { _id: '$category', count: { $sum: 1 } } }]),
    ]);

    const total = await Vendor.countDocuments();

    res.json({
      success: true,
      stats: {
        total,
        byStatus:   Object.fromEntries(statusStats.map(s => [s._id, s.count])),
        byCategory: Object.fromEntries(categoryStats.map(s => [s._id, s.count])),
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/vendors/status/:status
export const getVendorsByStatus = async (req, res) => {
  try {
    const vendors = await Vendor.find({ status: req.params.status }).sort({ companyName: 1 });
    res.json({ success: true, vendors });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/vendors/:id
export const getVendorById = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    // Also return price list
    const prices = await VendorPrice.find({ vendor: req.params.id, isActive: true });
    res.json({ success: true, vendor, prices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// PUT /api/vendors/:id
export const updateVendor = async (req, res) => {
  try {
    // Prevent vendorId from being changed
    delete req.body.vendorId;

    const vendor = await Vendor.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true,
    });
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });
    res.json({ success: true, vendor });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /api/vendors/:id
export const deleteVendor = async (req, res) => {
  try {
    const vendor = await Vendor.findByIdAndDelete(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    // Clean up price mappings too
    await VendorPrice.deleteMany({ vendor: req.params.id });

    res.json({ success: true, message: 'Vendor and price mappings deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ── Price Mapping ─────────────────────────────────────────────────────────────

// GET /api/vendors/:id/prices
export const getVendorPrices = async (req, res) => {
  try {
    const prices = await VendorPrice.find({ vendor: req.params.id }).sort({ productName: 1 });
    res.json({ success: true, prices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// POST /api/vendors/:id/prices
export const addVendorPrice = async (req, res) => {
  try {
    const vendor = await Vendor.findById(req.params.id);
    if (!vendor) return res.status(404).json({ success: false, message: 'Vendor not found' });

    const price = await VendorPrice.create({ ...req.body, vendor: req.params.id });
    res.status(201).json({ success: true, price });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({ success: false, message: 'Product code already mapped for this vendor' });
    }
    res.status(400).json({ success: false, message: error.message });
  }
};

// PUT /api/vendors/:id/prices/:priceId
export const updateVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.findOneAndUpdate(
      { _id: req.params.priceId, vendor: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!price) return res.status(404).json({ success: false, message: 'Price entry not found' });
    res.json({ success: true, price });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// DELETE /api/vendors/:id/prices/:priceId
export const deleteVendorPrice = async (req, res) => {
  try {
    const price = await VendorPrice.findOneAndDelete({
      _id: req.params.priceId,
      vendor: req.params.id,
    });
    if (!price) return res.status(404).json({ success: false, message: 'Price entry not found' });
    res.json({ success: true, message: 'Price mapping deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/vendors/prices/product?name=xxx  — compare prices across vendors for a product
export const getPricesByProduct = async (req, res) => {
  try {
    const { name, code } = req.query;
    if (!name && !code) {
      return res.status(400).json({ success: false, message: 'Provide product name or code' });
    }

    const filter = { isActive: true };
    if (code) filter.productCode = { $regex: code, $options: 'i' };
    else      filter.productName = { $regex: name, $options: 'i' };

    const prices = await VendorPrice.find(filter)
      .populate('vendor', 'vendorId companyName category status rating paymentTerms')
      .sort({ unitPrice: 1 }); // cheapest first

    res.json({ success: true, prices });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
