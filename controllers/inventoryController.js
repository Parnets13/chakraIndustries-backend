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
      .populate('category', 'name')
      .populate('grnId',    'grnId')
      .populate('poId',     'poId')
      .populate('vendorId', 'companyName')
      .sort({ updatedAt: -1 });
    
    console.log('Raw items from DB:', items.length, 'items');
    if (items.length > 0) {
      console.log('First item raw:', items[0]);
    }
    
    // Ensure all items have name field - handle legacy data
    const itemsWithName = items.map(item => {
      const itemObj = item.toObject();
      
      // Ensure name exists
      if (!itemObj.name || itemObj.name === '' || itemObj.name === null) {
        itemObj.name = itemObj.sku || 'Unknown Item';
      }
      
      // Ensure category is properly formatted
      if (itemObj.category && typeof itemObj.category === 'object' && itemObj.category._id) {
        // Category is already populated correctly
      } else if (itemObj.category && typeof itemObj.category === 'string') {
        // Category is just an ID, convert to object
        itemObj.category = { _id: itemObj.category, name: 'Unknown' };
      } else {
        itemObj.category = null;
      }
      
      return itemObj;
    });
    
    console.log('Items after processing:', itemsWithName.length);
    if (itemsWithName.length > 0) {
      console.log('First processed item:', itemsWithName[0]);
    }
    
    res.json({ success: true, data: itemsWithName });
  } catch (err) {
    console.error('Error in getAllInventory:', err);
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
    const { sku, name, qty, minQty, warehouse, unit, category, batch } = req.body;
    if (!sku) return res.status(400).json({ success: false, message: 'SKU is required' });

    const existing = await InventoryItem.findOne({ sku });
    if (existing) return res.status(400).json({ success: false, message: `SKU ${sku} already exists` });

    // Ensure name is provided and not empty
    let finalName = name;
    if (!finalName || finalName.trim() === '') {
      finalName = `Item-${sku}`;
    }

    const q = parseInt(qty);
    if (isNaN(q) || q < 0) return res.status(400).json({ success: false, message: 'qty must be a valid non-negative number' });
    
    const m = parseInt(minQty) || 0;
    const status = q === 0 ? 'Dead' : q < m ? 'Critical' : 'Active';

    const item = await InventoryItem.create({ 
      sku, 
      name: finalName, 
      qty: q, 
      minQty: m, 
      warehouse: warehouse || 'WH-01', 
      unit: unit || 'Nos', 
      category: category || null, 
      status 
    });
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
    const { force } = req.query; // ?force=true to also delete linked inventory items

    // First find the warehouse to get its warehouseId string
    const warehouse = await Warehouse.findById(req.params.id);
    if (!warehouse) {
      return res.status(404).json({ success: false, message: 'Warehouse not found' });
    }

    // Check for linked inventory items (items store warehouse as warehouseId string)
    const linkedItems = await InventoryItem.countDocuments({ warehouse: warehouse.warehouseId });
    if (linkedItems > 0) {
      if (force !== 'true') {
        return res.status(400).json({
          success: false,
          message: `Cannot delete warehouse — it has ${linkedItems} inventory item(s) linked to it. Move or delete those items first, or use force delete.`,
          linkedItems
        });
      }
      // Force delete: remove all linked inventory items first
      await InventoryItem.deleteMany({ warehouse: warehouse.warehouseId });
    }

    await Warehouse.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Warehouse deleted successfully', deletedItems: force === 'true' ? linkedItems : 0 });
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
  try {
    const { items, grnId, poId, vendorId, warehouseId } = qcData;
    
    if (!items || items.length === 0) {
      console.log('No items to process in QC');
      return;
    }

    console.log(`[INVENTORY UPDATE] Starting inventory update for GRN: ${grnId}`);
    console.log(`[INVENTORY UPDATE] Items to process: ${items.length}`);

    for (const item of items) {
      const passedQty = item.passedQty || 0;
      if (passedQty <= 0) {
        console.log(`[INVENTORY UPDATE] Skipping item ${item.itemName} - passedQty: ${passedQty}`);
        continue;
      }

      // Generate SKU from item name if not provided
      const sku = item.sku || item.itemName?.replace(/\s+/g, '-').toUpperCase() || `SKU-${Date.now()}`;
      const itemName = item.itemName || item.name || 'Item';
      const unit = item.unit || 'Nos';
      const warehouse = warehouseId || 'WH-01';

      console.log(`[INVENTORY UPDATE] Processing item: ${itemName} (SKU: ${sku}, Qty: ${passedQty})`);

      // Check if item already exists in inventory
      const existing = await InventoryItem.findOne({ sku });

      if (existing) {
        // Update existing item
        const oldQty = existing.qty;
        existing.qty += passedQty;
        existing.lastReceivedAt = new Date();
        existing.status = existing.qty === 0 ? 'Dead' : existing.qty < existing.minQty ? 'Critical' : 'Active';
        
        // Link to GRN if not already linked
        if (!existing.grnId) existing.grnId = grnId;
        if (!existing.poId) existing.poId = poId;
        if (!existing.vendorId) existing.vendorId = vendorId;
        
        await existing.save();
        console.log(`[INVENTORY UPDATE] ✅ Updated inventory: ${sku} | ${oldQty} → ${existing.qty} units | Status: ${existing.status}`);
      } else {
        // Create new inventory item
        const newItem = await InventoryItem.create({
          sku,
          name: itemName,
          qty: passedQty,
          unit,
          warehouse,
          minQty: 0,
          grnId,
          poId,
          vendorId,
          lastReceivedAt: new Date(),
          status: 'Active',
        });
        console.log(`[INVENTORY UPDATE] ✅ Created new inventory: ${sku} | Qty: ${passedQty} | Warehouse: ${warehouse}`);
      }

      // Log inward movement
      const movId = await genId(StockMovement, 'movementId', 'MV');
      await StockMovement.create({
        movementId: movId,
        type: 'Inward',
        sku,
        name: itemName,
        qty: passedQty,
        from: 'GRN/QC',
        to: warehouse,
        ref: grnId?.toString() || '',
      });
      console.log(`[INVENTORY UPDATE] ✅ Logged movement: ${movId} | ${itemName} | ${passedQty} units`);
    }

    console.log(`[INVENTORY UPDATE] ✅ Inventory update completed for GRN: ${grnId}`);
  } catch (error) {
    console.error('[INVENTORY UPDATE] ❌ Error updating inventory from QC:', error);
    throw error;
  }
};

// Get stock by warehouse
export const getStockByWarehouse = async (req, res) => {
  try {
    const { warehouseId } = req.params;
    
    const stock = await Inventory.find({ warehouse: warehouseId })
      .populate('warehouse', 'warehouseId name')
      .populate('category', 'name');
    
    res.json({
      success: true,
      data: stock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching warehouse stock',
      error: error.message
    });
  }
};

// Get stock by location
export const getStockByLocation = async (req, res) => {
  try {
    const { locationId } = req.params;
    
    const stock = await Inventory.find({
      'location.zone': locationId
    }).populate('warehouse', 'warehouseId name');
    
    res.json({
      success: true,
      data: stock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching location stock',
      error: error.message
    });
  }
};

// Get stock by SKU
export const getStockBySKU = async (req, res) => {
  try {
    const { sku } = req.params;
    
    const stock = await Inventory.findOne({ sku: sku.toUpperCase() })
      .populate('warehouse', 'warehouseId name')
      .populate('category', 'name');
    
    if (!stock) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }
    
    res.json({
      success: true,
      data: stock
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock by SKU',
      error: error.message
    });
  }
};

// Get stock type breakdown for SKU
export const getStockTypeBreakdown = async (req, res) => {
  try {
    const { sku } = req.params;
    
    const inventory = await Inventory.findOne({ sku: sku.toUpperCase() });
    
    if (!inventory) {
      return res.status(404).json({
        success: false,
        message: 'SKU not found'
      });
    }
    
    // Calculate stock breakdown based on status and quantity
    const breakdown = {
      sku: inventory.sku,
      itemName: inventory.name,
      total: inventory.quantity,
      available: inventory.status === 'Active' ? inventory.quantity : 0,
      reserved: 0,
      damaged: 0,
      expired: 0,
      transit: 0
    };
    
    res.json({
      success: true,
      data: breakdown
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock breakdown',
      error: error.message
    });
  }
};

// Get all stock with filters
export const getAllStock = async (req, res) => {
  try {
    const { sku, type, warehouse, status } = req.query;
    
    let query = {};
    
    if (sku) {
      query.sku = { $regex: sku, $options: 'i' };
    }
    
    if (warehouse) {
      query.warehouse = warehouse;
    }
    
    if (status) {
      query.status = status;
    }
    
    const stock = await Inventory.find(query)
      .populate('warehouse', 'warehouseId name')
      .populate('category', 'name')
      .sort({ sku: 1 });
    
    // Add stock type breakdown
    const stockWithBreakdown = stock.map(item => ({
      ...item.toObject(),
      available: item.status === 'Active' ? item.quantity : 0,
      reserved: 0,
      damaged: 0,
      expired: 0,
      transit: 0,
      total: item.quantity
    }));
    
    res.json({
      success: true,
      data: stockWithBreakdown
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error fetching stock',
      error: error.message
    });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// NEW: Convert GRN items to inventory directly
// ══════════════════════════════════════════════════════════════════════════════
export const convertGRNToInventory = async (req, res) => {
  try {
    const { grnId } = req.params;
    
    // Import GRN model
    const GRN = require('../models/GRN.js').default;
    
    // Get GRN with all details
    const grn = await GRN.findById(grnId)
      .populate('poId', 'items')
      .populate('vendorId', '_id')
      .populate('warehouseId', '_id');
    
    if (!grn) {
      return res.status(404).json({ success: false, message: 'GRN not found' });
    }

    console.log(`[CONVERT GRN] Converting GRN ${grn.grnId} items to inventory`);
    console.log(`[CONVERT GRN] Items count: ${grn.items.length}`);

    const createdItems = [];

    // Process each item in GRN
    for (const item of grn.items) {
      const receivedQty = item.receivedQty || 0;
      if (receivedQty <= 0) continue;

      const sku = item.sku || item.name?.replace(/\s+/g, '-').toUpperCase() || `SKU-${Date.now()}`;
      const itemName = item.name || 'Item';
      const unit = item.unit || 'Nos';
      const warehouse = grn.warehouseId?._id || 'WH-01';

      console.log(`[CONVERT GRN] Processing: ${itemName} (SKU: ${sku}, Qty: ${receivedQty})`);

      // Check if exists
      const existing = await InventoryItem.findOne({ sku });

      if (existing) {
        const oldQty = existing.qty;
        existing.qty += receivedQty;
        existing.lastReceivedAt = new Date();
        existing.status = existing.qty === 0 ? 'Dead' : existing.qty < existing.minQty ? 'Critical' : 'Active';
        
        if (!existing.grnId) existing.grnId = grn._id;
        if (!existing.poId) existing.poId = grn.poId;
        if (!existing.vendorId) existing.vendorId = grn.vendorId;
        
        await existing.save();
        console.log(`[CONVERT GRN] ✅ Updated: ${sku} | ${oldQty} → ${existing.qty}`);
        createdItems.push({ sku, name: itemName, qty: receivedQty, action: 'updated' });
      } else {
        const newItem = await InventoryItem.create({
          sku,
          name: itemName,
          qty: receivedQty,
          unit,
          warehouse,
          minQty: 0,
          grnId: grn._id,
          poId: grn.poId,
          vendorId: grn.vendorId,
          lastReceivedAt: new Date(),
          status: 'Active',
        });
        console.log(`[CONVERT GRN] ✅ Created: ${sku} | Qty: ${receivedQty}`);
        createdItems.push({ sku, name: itemName, qty: receivedQty, action: 'created' });
      }

      // Log movement
      const movId = await genId(StockMovement, 'movementId', 'MV');
      await StockMovement.create({
        movementId: movId,
        type: 'Inward',
        sku,
        name: itemName,
        qty: receivedQty,
        from: 'GRN',
        to: warehouse,
        ref: grn.grnId,
      });
    }

    // Update GRN status
    await GRN.findByIdAndUpdate(grnId, { grnStatus: 'Inventory_Updated' });

    console.log(`[CONVERT GRN] ✅ Conversion complete for GRN ${grn.grnId}`);

    res.json({
      success: true,
      message: `${createdItems.length} items converted to inventory`,
      data: {
        grnId: grn.grnId,
        itemsProcessed: createdItems.length,
        items: createdItems,
      },
    });
  } catch (error) {
    console.error('[CONVERT GRN] ❌ Error:', error);
    res.status(500).json({
      success: false,
      message: 'Error converting GRN to inventory',
      error: error.message,
    });
  }
};
