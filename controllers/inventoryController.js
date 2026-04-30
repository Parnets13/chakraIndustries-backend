import InventoryItem from '../models/InventoryItem.js';
import Warehouse from '../models/Warehouse.js';
import StockMovement from '../models/StockMovement.js';

// ── ID generator ──────────────────────────────────────────────────────────────
const genId = async (Model, field, prefix) => {
  const last = await Model.findOne({ [field]: new RegExp(`^${prefix}-`) }).sort({ [field]: -1 });
  if (!last) return `${prefix}-001`;
  const num = parseInt(last[field].split('-').pop()) || 0;
  return `${prefix}-${String(num + 1).padStart(3, '0')}`;
};

// ══════════════════════════════════════════════════════════════════════════════
// INVENTORY ITEMS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/inventory
export const getAllInventory = async (req, res) => {
  try {
    const { warehouse, status, search } = req.query;
    const filter = {};
    if (warehouse) filter.warehouse = warehouse;
    if (status)    filter.status    = status;
    if (search)    filter.$or = [
      { sku:  { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } },
    ];
    const items = await InventoryItem.find(filter)
      .populate('grnId',    'grnId')
      .populate('poId',     'poId')
      .populate('vendorId', 'companyName')
      .sort({ updatedAt: -1 });
    res.json({ success: true, data: items });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/inventory/stats
export const getInventoryStats = async (req, res) => {
  try {
    const items      = await InventoryItem.find();
    const warehouses = await Warehouse.find();
    const movements  = await StockMovement.find();

    const total    = items.length;
    const active   = items.filter(i => i.status === 'Active').length;
    const critical = items.filter(i => i.status === 'Critical').length;
    const dead     = items.filter(i => i.status === 'Dead').length;
    const totalQty = items.reduce((s, i) => s + i.qty, 0);

    // Category breakdown by warehouse prefix (simple heuristic)
    const byWarehouse = {};
    for (const wh of warehouses) {
      const whItems = items.filter(i => i.warehouse === wh.warehouseId);
      byWarehouse[wh.warehouseId] = {
        name: wh.name,
        skus: whItems.length,
        qty:  whItems.reduce((s, i) => s + i.qty, 0),
      };
    }

    // Today's movements
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMov = movements.filter(m => new Date(m.createdAt) >= today);

    res.json({
      success: true,
      data: {
        total, active, critical, dead, totalQty,
        byWarehouse,
        inwardToday:   todayMov.filter(m => m.type === 'Inward').length,
        outwardToday:  todayMov.filter(m => m.type === 'Outward').length,
        transferToday: todayMov.filter(m => m.type === 'Transfer').length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/inventory
export const createInventoryItem = async (req, res) => {
  try {
    const { sku, name, qty, minQty, warehouse, unit, batch } = req.body;
    if (!sku || !name) return res.status(400).json({ success: false, message: 'SKU and name are required' });

    const existing = await InventoryItem.findOne({ sku });
    if (existing) return res.status(400).json({ success: false, message: `SKU ${sku} already exists` });

    const q = parseInt(qty) || 0;
    const m = parseInt(minQty) || 0;
    const status = q === 0 ? 'Dead' : q < m ? 'Critical' : 'Active';

    const item = await InventoryItem.create({ sku, name, qty: q, minQty: m, warehouse: warehouse || 'WH-01', unit: unit || 'Nos', status });
    res.status(201).json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/inventory/:id/adjust
export const adjustInventoryQty = async (req, res) => {
  try {
    const { qty, reason } = req.body;
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const newQty = parseInt(qty);
    item.qty    = newQty;
    item.status = newQty === 0 ? 'Dead' : newQty < item.minQty ? 'Critical' : 'Active';
    await item.save();

    // Log as movement
    const movId = await genId(StockMovement, 'movementId', 'MV');
    await StockMovement.create({
      movementId: movId,
      type: 'Inward',
      sku: item.sku,
      name: item.name,
      qty: newQty,
      from: 'Manual Adjustment',
      to: item.warehouse,
      ref: reason || 'Stock Adjustment',
    });

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/inventory/:id/move
export const moveInventoryItem = async (req, res) => {
  try {
    const { toWarehouse } = req.body;
    const item = await InventoryItem.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Item not found' });

    const fromWH = item.warehouse;
    item.warehouse = toWarehouse;
    await item.save();

    // Log as transfer movement
    const movId = await genId(StockMovement, 'movementId', 'MV');
    await StockMovement.create({
      movementId: movId,
      type: 'Transfer',
      sku: item.sku,
      name: item.name,
      qty: item.qty,
      from: fromWH,
      to: toWarehouse,
      ref: 'Stock Transfer',
    });

    res.json({ success: true, data: item });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/inventory/:id
export const deleteInventoryItem = async (req, res) => {
  try {
    await InventoryItem.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// WAREHOUSES
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/inventory/warehouses
export const getWarehouses = async (req, res) => {
  try {
    const warehouses = await Warehouse.find({ status: 'Active' }).sort({ createdAt: 1 });
    // Compute used (total qty of items in each warehouse)
    const items = await InventoryItem.find();
    const result = warehouses.map(wh => {
      const whItems = items.filter(i => i.warehouse === wh.warehouseId);
      return {
        ...wh.toObject(),
        id:   wh.warehouseId,
        used: whItems.reduce((s, i) => s + i.qty, 0),
        skus: whItems.length,
      };
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/inventory/warehouses
export const createWarehouse = async (req, res) => {
  try {
    const { name, location, manager, capacity, phone, address, type } = req.body;
    if (!name || !location) {
      return res.status(400).json({ success: false, message: 'Name and location are required' });
    }

    // Auto-generate warehouseId: find highest existing number and increment
    const all = await Warehouse.find({}, 'warehouseId').sort({ createdAt: -1 });
    let nextNum = 1;
    if (all.length > 0) {
      const nums = all
        .map(w => { const m = w.warehouseId?.match(/(\d+)$/); return m ? parseInt(m[1]) : 0; })
        .filter(n => !isNaN(n));
      if (nums.length > 0) nextNum = Math.max(...nums) + 1;
    }
    let warehouseId = `WH-${String(nextNum).padStart(2, '0')}`;
    // Guarantee uniqueness
    while (await Warehouse.findOne({ warehouseId })) {
      nextNum++;
      warehouseId = `WH-${String(nextNum).padStart(2, '0')}`;
    }

    const wh = await Warehouse.create({
      warehouseId, name, location,
      manager:  manager  || '',
      capacity: parseInt(capacity) || 0,
      phone:    phone    || '',
      address:  address  || '',
      type:     type     || 'Raw Material',
    });
    res.status(201).json({ success: true, data: { ...wh.toObject(), id: wh.warehouseId, used: 0, skus: 0 } });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/inventory/warehouses/next-id
export const getNextWarehouseId = async (req, res) => {
  try {
    const all = await Warehouse.find({}, 'warehouseId');
    let nextNum = 1;
    if (all.length > 0) {
      const nums = all
        .map(w => { const m = w.warehouseId?.match(/(\d+)$/); return m ? parseInt(m[1]) : 0; })
        .filter(n => !isNaN(n));
      if (nums.length > 0) nextNum = Math.max(...nums) + 1;
    }
    let warehouseId = `WH-${String(nextNum).padStart(2, '0')}`;
    while (await Warehouse.findOne({ warehouseId })) {
      nextNum++;
      warehouseId = `WH-${String(nextNum).padStart(2, '0')}`;
    }
    res.json({ success: true, data: { warehouseId } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/inventory/warehouses/:id
export const updateWarehouse = async (req, res) => {
  try {
    const wh = await Warehouse.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!wh) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: wh });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/inventory/warehouses/:id
export const deleteWarehouse = async (req, res) => {
  try {
    await Warehouse.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// STOCK MOVEMENTS
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/inventory/movements
export const getMovements = async (req, res) => {
  try {
    const { type } = req.query;
    const filter = type ? { type } : {};
    const list = await StockMovement.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/inventory/movements
export const createMovement = async (req, res) => {
  try {
    const { type, sku, qty, from, to, ref, notes } = req.body;
    if (!type || !sku || !qty || !from || !to) {
      return res.status(400).json({ success: false, message: 'type, sku, qty, from, to are required' });
    }
    const movementId = await genId(StockMovement, 'movementId', 'MV');

    // Find item name
    const item = await InventoryItem.findOne({ sku });
    const movement = await StockMovement.create({
      movementId, type, sku, name: item?.name || sku,
      qty: parseInt(qty), from, to, ref: ref || '', notes: notes || '',
    });

    // Update stock qty for inward/outward
    if (item) {
      if (type === 'Inward')  item.qty += parseInt(qty);
      if (type === 'Outward') item.qty = Math.max(0, item.qty - parseInt(qty));
      if (type === 'Transfer') item.warehouse = to;
      item.status = item.qty === 0 ? 'Dead' : item.qty < item.minQty ? 'Critical' : 'Active';
      await item.save();
    }

    res.status(201).json({ success: true, data: movement });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/inventory/movements/:id
export const deleteMovement = async (req, res) => {
  try {
    await StockMovement.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// INTERNAL — called after QC pass
// ══════════════════════════════════════════════════════════════════════════════
export const updateInventoryFromQC = async (qcData) => {
  const { items, grnId, poId, vendorId } = qcData;
  for (const item of items) {
    const passedQty = item.passedQty || 0;
    if (passedQty <= 0) continue;
    const sku = item.sku || item.itemName?.replace(/\s+/g, '-').toUpperCase() || 'UNKNOWN';
    const existing = await InventoryItem.findOne({ sku });
    if (existing) {
      existing.qty += passedQty;
      existing.lastReceivedAt = new Date();
      existing.status = existing.qty === 0 ? 'Dead' : existing.qty < existing.minQty ? 'Critical' : 'Active';
      await existing.save();
    } else {
      await InventoryItem.create({
        sku, name: item.itemName || item.name || sku,
        qty: passedQty, unit: item.unit || 'Nos',
        grnId, poId, vendorId,
        lastReceivedAt: new Date(), status: 'Active',
      });
    }
    // Log inward movement
    const movId = await genId(StockMovement, 'movementId', 'MV');
    await StockMovement.create({
      movementId: movId, type: 'Inward', sku,
      name: item.itemName || item.name || sku,
      qty: passedQty, from: 'GRN/QC', to: 'WH-01', ref: grnId?.toString() || '',
    });
  }
};
