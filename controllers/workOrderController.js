import WorkOrder from '../models/WorkOrder.js';
import BOM from '../models/BOM.js';

async function generateWoId() {
  const last = await WorkOrder.findOne().sort({ createdAt: -1 }).select('woId');
  let nextNum = 1;
  if (last?.woId) {
    const m = last.woId.match(/(\d+)$/);
    if (m) nextNum = parseInt(m[1]) + 1;
  }
  let woId = `WO-${String(nextNum).padStart(4, '0')}`;
  while (await WorkOrder.findOne({ woId })) {
    nextNum++;
    woId = `WO-${String(nextNum).padStart(4, '0')}`;
  }
  return woId;
}

// GET /api/workorders
export const getAllWorkOrders = async (req, res) => {
  try {
    const wos = await WorkOrder.find().populate('bomId', 'bomId product version').sort({ createdAt: -1 });
    res.json({ success: true, data: wos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/workorders/:id
export const getWorkOrderById = async (req, res) => {
  try {
    const wo = await WorkOrder.findById(req.params.id).populate('bomId', 'bomId product version components');
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, data: wo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/workorders
export const createWorkOrder = async (req, res) => {
  try {
    const { product, bomId, qty, shift, priority, startDate, endDate, remarks } = req.body;
    if (!product?.trim()) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!qty || qty < 1) return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });

    // If bomId provided, verify it exists
    if (bomId) {
      const bom = await BOM.findById(bomId);
      if (!bom) return res.status(400).json({ success: false, message: 'Referenced BOM not found' });
    }

    const woId = await generateWoId();
    const wo = await WorkOrder.create({ woId, product, bomId: bomId || null, qty, shift, priority, startDate, endDate, remarks });
    const populated = await wo.populate('bomId', 'bomId product version');
    res.status(201).json({ success: true, message: 'Work order created', data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/workorders/:id — update header fields
export const updateWorkOrder = async (req, res) => {
  try {
    const wo = await WorkOrder.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('bomId', 'bomId product version');
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, message: 'Work order updated', data: wo });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/workorders/:id/progress — update produced count
export const updateProgress = async (req, res) => {
  try {
    const { produced } = req.body;
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });

    const newProduced = Math.min(parseInt(produced), wo.qty);
    wo.produced = newProduced;
    wo.status = newProduced >= wo.qty ? 'Completed' : newProduced > 0 ? 'In-Progress' : 'Pending';
    await wo.save();

    res.json({ success: true, message: 'Progress updated', data: wo });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/workorders/:id
export const deleteWorkOrder = async (req, res) => {
  try {
    const wo = await WorkOrder.findByIdAndDelete(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, message: 'Work order deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
