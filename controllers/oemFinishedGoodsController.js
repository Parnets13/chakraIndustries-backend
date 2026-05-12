import OEMFinishedGoods from '../models/OEMFinishedGoods.js';
import OEMOrder from '../models/OEMOrder.js';

// ── ID generator ──────────────────────────────────────────────────────────────
async function genFinishedGoodsId() {
  const last = await OEMFinishedGoods.findOne().sort({ createdAt: -1 }).select('finishedGoodsId');
  let n = 1;
  if (last?.finishedGoodsId) { const m = last.finishedGoodsId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `OEMFG-${String(n).padStart(5, '0')}`;
  while (await OEMFinishedGoods.findOne({ finishedGoodsId: id })) { n++; id = `OEMFG-${String(n).padStart(5, '0')}`; }
  return id;
}

// ══════════════════════════════════════════════════════════════════════════════
// OEM FINISHED GOODS CRUD
// ══════════════════════════════════════════════════════════════════════════════

export const getAllOEMFinishedGoods = async (req, res) => {
  try {
    const { status, skip = 0, limit = 50 } = req.query;
    const query = {};
    if (status) query.status = status;

    const goods = await OEMFinishedGoods.find(query)
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('qcCheckId', 'qcId status result')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await OEMFinishedGoods.countDocuments(query);
    res.json({ success: true, data: goods, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getOEMFinishedGoodsByOrder = async (req, res) => {
  try {
    const { orderId } = req.params;
    const goods = await OEMFinishedGoods.find({ oemOrderId: orderId })
      .populate('qcCheckId', 'qcId status result')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: goods });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getOEMFinishedGoodsByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { status, skip = 0, limit = 50 } = req.query;
    const query = { oemBrand: brandId };
    if (status) query.status = status;

    const goods = await OEMFinishedGoods.find(query)
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('qcCheckId', 'qcId status result')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await OEMFinishedGoods.countDocuments(query);
    res.json({ success: true, data: goods, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getOEMFinishedGoodsById = async (req, res) => {
  try {
    const goods = await OEMFinishedGoods.findById(req.params.id)
      .populate('oemOrderId', 'oemOrderId product quantity bomId')
      .populate('qcCheckId', 'qcId status result defectCount');
    if (!goods) return res.status(404).json({ success: false, message: 'Finished goods not found' });
    res.json({ success: true, data: goods });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createOEMFinishedGoods = async (req, res) => {
  try {
    const { oemOrderId, product, quantity, batchNumber, qcStatus } = req.body;
    if (!oemOrderId) return res.status(400).json({ success: false, message: 'OEM order is required' });
    if (!product?.trim()) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!quantity || quantity < 1) return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
    if (!batchNumber?.trim()) return res.status(400).json({ success: false, message: 'Batch number is required' });
    if (!qcStatus) return res.status(400).json({ success: false, message: 'QC status is required' });

    const order = await OEMOrder.findById(oemOrderId);
    if (!order) return res.status(400).json({ success: false, message: 'OEM order not found' });

    const finishedGoodsId = await genFinishedGoodsId();
    const goods = await OEMFinishedGoods.create({
      finishedGoodsId,
      oemOrderId,
      product,
      quantity,
      batchNumber,
      qcStatus,
      productionDate: new Date(),
      ...req.body,
    });

    const populated = await goods.populate([
      { path: 'oemOrderId', select: 'oemOrderId product quantity' },
      { path: 'qcCheckId', select: 'qcId status result' },
    ]);

    res.status(201).json({ success: true, message: 'Finished goods created', data: populated });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateOEMFinishedGoods = async (req, res) => {
  try {
    const goods = await OEMFinishedGoods.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('qcCheckId', 'qcId status result');
    if (!goods) return res.status(404).json({ success: false, message: 'Finished goods not found' });
    res.json({ success: true, message: 'Finished goods updated', data: goods });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateOEMFinishedGoodsStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

    const goods = await OEMFinishedGoods.findByIdAndUpdate(req.params.id, { status }, { new: true })
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('qcCheckId', 'qcId status result');
    if (!goods) return res.status(404).json({ success: false, message: 'Finished goods not found' });
    res.json({ success: true, message: 'Status updated', data: goods });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteOEMFinishedGoods = async (req, res) => {
  try {
    const goods = await OEMFinishedGoods.findByIdAndDelete(req.params.id);
    if (!goods) return res.status(404).json({ success: false, message: 'Finished goods not found' });
    res.json({ success: true, message: 'Finished goods deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// OEM FINISHED GOODS STATS
// ══════════════════════════════════════════════════════════════════════════════
export const getOEMFinishedGoodsStats = async (req, res) => {
  try {
    const { brandId } = req.query;
    const query = brandId ? { oemBrand: brandId } : {};

    const total = await OEMFinishedGoods.countDocuments(query);
    const byStatus = await OEMFinishedGoods.aggregate([
      { $match: query },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const byQCStatus = await OEMFinishedGoods.aggregate([
      { $match: query },
      { $group: { _id: '$qcStatus', count: { $sum: 1 } } },
    ]);

    const totalQuantity = await OEMFinishedGoods.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$quantity' } } },
    ]);

    res.json({
      success: true,
      data: {
        totalFinishedGoods: total,
        byStatus: byStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
        byQCStatus: byQCStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
        totalQuantity: totalQuantity[0]?.total || 0,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
