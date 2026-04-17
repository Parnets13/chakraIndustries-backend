import PurchaseOrder from '../models/PurchaseOrder.js';

// CREATE
export const createPurchaseOrder = async (req, res) => {
  try {
    const po = new PurchaseOrder(req.body);
    const saved = await po.save();
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// READ ALL
export const getAllPurchaseOrders = async (req, res) => {
  try {
    const orders = await PurchaseOrder.find()
      .populate('vendorId', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ STATS
export const getPOStats = async (req, res) => {
  try {
    const total = await PurchaseOrder.countDocuments();
    const pending = await PurchaseOrder.countDocuments({ status: 'Pending' });
    const approved = await PurchaseOrder.countDocuments({ status: 'Approved' });
    const received = await PurchaseOrder.countDocuments({ status: 'Received' });
    const cancelled = await PurchaseOrder.countDocuments({ status: 'Cancelled' });
    res.json({ success: true, data: { total, pending, approved, received, cancelled } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// READ ONE
export const getPurchaseOrderById = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id).populate('vendorId', 'name');
    if (!po) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    res.json({ success: true, data: po });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE
export const updatePurchaseOrder = async (req, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!po) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    res.json({ success: true, data: po });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// UPDATE STATUS
export const updatePOStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const po = await PurchaseOrder.findByIdAndUpdate(req.params.id, { status }, { new: true, runValidators: true });
    if (!po) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    res.json({ success: true, data: po });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE
export const deletePurchaseOrder = async (req, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndDelete(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    res.json({ success: true, message: 'Purchase Order deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
