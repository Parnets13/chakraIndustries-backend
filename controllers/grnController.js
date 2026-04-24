import GRN from '../models/GRN.js';

// Generate GRN ID (GRN-2026-001)
const generateGRNId = async () => {
  const year = new Date().getFullYear();
  const prefix = `GRN-${year}-`;
  const last = await GRN.findOne({ grnId: new RegExp(`^${prefix}`) })
    .sort({ grnId: -1 })
    .limit(1);
  if (!last) return `${prefix}001`;
  const lastNum = parseInt(last.grnId.split('-')[2]) || 0;
  return `${prefix}${String(lastNum + 1).padStart(3, '0')}`;
};

// CREATE
export const createGRN = async (req, res) => {
  try {
    const grnId = await generateGRNId();
    const grn = new GRN({ ...req.body, grnId });
    const saved = await grn.save();
    const populated = await GRN.findById(saved._id)
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL
export const getAllGRNs = async (req, res) => {
  try {
    const grns = await GRN.find()
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: grns });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ STATS
export const getGRNStats = async (req, res) => {
  try {
    const total = await GRN.countDocuments();
    const completed = await GRN.countDocuments({ status: 'Completed' });
    const partial = await GRN.countDocuments({ status: 'Partial' });
    const pending = await GRN.countDocuments({ status: 'Pending' });
    res.json({ success: true, data: { total, completed, partial, pending } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ ONE
export const getGRNById = async (req, res) => {
  try {
    const grn = await GRN.findById(req.params.id)
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId');
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    res.json({ success: true, data: grn });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE
export const updateGRN = async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const grn = await GRN.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId');
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    res.json({ success: true, data: grn });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE
export const deleteGRN = async (req, res) => {
  try {
    const grn = await GRN.findByIdAndDelete(req.params.id);
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });
    res.json({ success: true, message: 'GRN deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
