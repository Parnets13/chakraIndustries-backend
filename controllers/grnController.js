import GRN from '../models/GRN.js';

// CREATE
export const createGRN = async (req, res) => {
  try {
    const grn = new GRN(req.body);
    const saved = await grn.save();
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL
export const getAllGRNs = async (req, res) => {
  try {
    const grns = await GRN.find()
      .populate('poId', 'poId')
      .populate('vendorId', 'name')
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
      .populate('poId', 'poId')
      .populate('vendorId', 'name');
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
    const grn = await GRN.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
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
