import PurchaseRequisition from '../models/PurchaseRequisition.js';

const generatePRId = async () => {
  const last = await PurchaseRequisition.findOne({}, {}, { sort: { createdAt: -1 } });
  const year = new Date().getFullYear();
  if (!last) return `PR-${year}-001`;
  const num = parseInt(last.prId.split('-')[2] || '0') + 1;
  return `PR-${year}-${String(num).padStart(3, '0')}`;
};

const calcTotal = (items) =>
  items.reduce((s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.estimatedPrice) || 0), 0);

// POST /api/purchase-requisitions
export const createPurchaseRequisition = async (req, res) => {
  try {
    const prId = await generatePRId();
    const totalValue = calcTotal(req.body.items || []);
    const pr = await PurchaseRequisition.create({ ...req.body, prId, totalValue });
    res.status(201).json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/purchase-requisitions
export const getAllPurchaseRequisitions = async (req, res) => {
  try {
    const { status, department } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (department) filter.department = department;
    const prs = await PurchaseRequisition.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: prs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/purchase-requisitions/stats
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

// GET /api/purchase-requisitions/:id
export const getPurchaseRequisitionById = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findById(req.params.id);
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/purchase-requisitions/:id
export const updatePurchaseRequisition = async (req, res) => {
  try {
    if (req.body.items) req.body.totalValue = calcTotal(req.body.items);
    const pr = await PurchaseRequisition.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/purchase-requisitions/:id/status
export const updatePRStatus = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/purchase-requisitions/:id
export const deletePurchaseRequisition = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findByIdAndDelete(req.params.id);
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    res.json({ success: true, message: 'PR deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
