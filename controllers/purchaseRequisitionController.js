import PurchaseRequisition from '../models/PurchaseRequisition.js';

// CREATE
export const createPurchaseRequisition = async (req, res) => {
  try {
    const pr = new PurchaseRequisition(req.body);
    const saved = await pr.save();
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL
export const getAllPurchaseRequisitions = async (req, res) => {
  try {
    const prs = await PurchaseRequisition.find().sort({ createdAt: -1 });
    res.json({ success: true, data: prs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ STATS
export const getPRStats = async (req, res) => {
  try {
    const total = await PurchaseRequisition.countDocuments();
    const pending = await PurchaseRequisition.countDocuments({ status: 'Pending' });
    const approved = await PurchaseRequisition.countDocuments({ status: 'Approved' });
    const rejected = await PurchaseRequisition.countDocuments({ status: 'Rejected' });
    res.json({ success: true, data: { total, pending, approved, rejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ ONE
export const getPurchaseRequisitionById = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findById(req.params.id);
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase Requisition not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE
export const updatePurchaseRequisition = async (req, res) => {
  try {
    req.body.updatedAt = new Date();
    const pr = await PurchaseRequisition.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase Requisition not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// UPDATE STATUS
export const updatePRStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const pr = await PurchaseRequisition.findByIdAndUpdate(
      req.params.id,
      { status, updatedAt: new Date() },
      { new: true, runValidators: true }
    );
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase Requisition not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE
export const deletePurchaseRequisition = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findByIdAndDelete(req.params.id);
    if (!pr) return res.status(404).json({ success: false, message: 'Purchase Requisition not found' });
    res.json({ success: true, message: 'Purchase Requisition deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
