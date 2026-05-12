import OEMOrder from '../models/OEMOrder.js';
import OEMBrand from '../models/OEMBrand.js';
import OEMProduct from '../models/OEMProduct.js';
import BOM from '../models/BOM.js';

// ── ID generator ──────────────────────────────────────────────────────────────
async function genOEMOrderId() {
  const last = await OEMOrder.findOne().sort({ createdAt: -1 }).select('oemOrderId');
  let n = 1;
  if (last?.oemOrderId) { const m = last.oemOrderId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `OEMORD-${String(n).padStart(5, '0')}`;
  while (await OEMOrder.findOne({ oemOrderId: id })) { n++; id = `OEMORD-${String(n).padStart(5, '0')}`; }
  return id;
}

// ══════════════════════════════════════════════════════════════════════════════
// OEM ORDER CRUD
// ══════════════════════════════════════════════════════════════════════════════

export const getAllOEMOrders = async (req, res) => {
  try {
    const { status, brandId, skip = 0, limit = 50 } = req.query;
    const query = {};
    if (status) query.status = status;
    if (brandId) query.oemBrand = brandId;

    const orders = await OEMOrder.find(query)
      .populate('oemBrand', 'brandId name code color')
      .populate('bomId', 'bomId product version')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await OEMOrder.countDocuments(query);
    res.json({ success: true, data: orders, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getOEMOrdersByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { status, skip = 0, limit = 50 } = req.query;
    const query = { oemBrand: brandId };
    if (status) query.status = status;

    const orders = await OEMOrder.find(query)
      .populate('bomId', 'bomId product version')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await OEMOrder.countDocuments(query);
    res.json({ success: true, data: orders, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getOEMOrderById = async (req, res) => {
  try {
    const order = await OEMOrder.findById(req.params.id)
      .populate('oemBrand', 'brandId name code color')
      .populate('bomId', 'bomId product version components');
    if (!order) return res.status(404).json({ success: false, message: 'OEM order not found' });
    res.json({ success: true, data: order });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createOEMOrder = async (req, res) => {
  try {
    const { oemBrand, product, quantity, bomId } = req.body;
    if (!oemBrand) return res.status(400).json({ success: false, message: 'OEM brand is required' });
    if (!product?.trim()) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!quantity || quantity < 1) return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
    if (!bomId) return res.status(400).json({ success: false, message: 'BOM is required' });

    const brand = await OEMBrand.findById(oemBrand);
    if (!brand) return res.status(400).json({ success: false, message: 'OEM brand not found' });

    const bom = await BOM.findById(bomId);
    if (!bom) return res.status(400).json({ success: false, message: 'BOM not found' });

    const oemOrderId = await genOEMOrderId();
    const order = await OEMOrder.create({
      oemOrderId,
      oemBrand,
      product,
      quantity,
      bomId,
      ...req.body,
    });

    const populated = await order.populate([
      { path: 'oemBrand', select: 'brandId name code color' },
      { path: 'bomId', select: 'bomId product version' },
    ]);

    res.status(201).json({ success: true, message: 'OEM order created', data: populated });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateOEMOrder = async (req, res) => {
  try {
    const order = await OEMOrder.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('oemBrand', 'brandId name code color')
      .populate('bomId', 'bomId product version');
    if (!order) return res.status(404).json({ success: false, message: 'OEM order not found' });
    res.json({ success: true, message: 'OEM order updated', data: order });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateOEMOrderStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const order = await OEMOrder.findByIdAndUpdate(req.params.id, { status }, { new: true })
      .populate('oemBrand', 'brandId name code color')
      .populate('bomId', 'bomId product version');
    if (!order) return res.status(404).json({ success: false, message: 'OEM order not found' });
    res.json({ success: true, message: 'OEM order status updated', data: order });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteOEMOrder = async (req, res) => {
  try {
    const order = await OEMOrder.findByIdAndDelete(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: 'OEM order not found' });
    res.json({ success: true, message: 'OEM order deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// OEM ORDER STATS
// ══════════════════════════════════════════════════════════════════════════════
export const getOEMOrderStats = async (req, res) => {
  try {
    const { brandId } = req.query;
    const query = brandId ? { oemBrand: brandId } : {};

    const total = await OEMOrder.countDocuments(query);
    const byStatus = await OEMOrder.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const totalQty = await OEMOrder.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$quantity' } } },
    ]);

    const totalCost = await OEMOrder.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$estimatedCost' } } },
    ]);

    res.json({
      success: true,
      data: {
        totalOrders: total,
        byStatus: byStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
        totalQuantity: totalQty[0]?.total || 0,
        totalEstimatedCost: totalCost[0]?.total || 0,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
