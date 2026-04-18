import RFQ from '../models/RFQ.js';

// CREATE
export const createRFQ = async (req, res) => {
  try {
    const rfq = new RFQ(req.body);
    const saved = await rfq.save();
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL
export const getAllRFQs = async (req, res) => {
  try {
    const rfqs = await RFQ.find()
      .populate('vendorId', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: rfqs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ STATS
export const getRFQStats = async (req, res) => {
  try {
    const total = await RFQ.countDocuments();
    const open = await RFQ.countDocuments({ status: 'Open' });
    const closed = await RFQ.countDocuments({ status: 'Closed' });
    const cancelled = await RFQ.countDocuments({ status: 'Cancelled' });
    res.json({ success: true, data: { total, open, closed, cancelled } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ ONE
export const getRFQById = async (req, res) => {
  try {
    const rfq = await RFQ.findById(req.params.id).populate('vendorId', 'name');
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found' });
    res.json({ success: true, data: rfq });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE
export const updateRFQ = async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const rfq = await RFQ.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found' });
    res.json({ success: true, data: rfq });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// UPDATE STATUS
export const updateRFQStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const rfq = await RFQ.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found' });
    res.json({ success: true, data: rfq });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE
export const deleteRFQ = async (req, res) => {
  try {
    const rfq = await RFQ.findByIdAndDelete(req.params.id);
    if (!rfq) return res.status(404).json({ success: false, message: 'RFQ not found' });
    res.json({ success: true, message: 'RFQ deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
