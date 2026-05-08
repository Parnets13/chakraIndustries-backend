import WorkOrder  from '../models/WorkOrder.js';
import BOM        from '../models/BOM.js';
import InventoryItem from '../models/InventoryItem.js';

async function generateWoId() {
  const last = await WorkOrder.findOne().sort({ createdAt: -1 }).select('woId');
  let n = 1;
  if (last?.woId) { const m = last.woId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `WO-${String(n).padStart(4, '0')}`;
  while (await WorkOrder.findOne({ woId: id })) { n++; id = `WO-${String(n).padStart(4, '0')}`; }
  return id;
}

// ── GET all ───────────────────────────────────────────────────────────────────
export const getAllWorkOrders = async (req, res) => {
  try {
    const { status, oemBrand } = req.query;
    const filter = {};
    if (status)   filter.status = status;
    if (oemBrand) filter.oemBrand = oemBrand;

    const wos = await WorkOrder.find(filter)
      .populate('bomId', 'bomId product version')
      .populate('oemBrand', 'brandId name code color')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: wos });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET single ────────────────────────────────────────────────────────────────
export const getWorkOrderById = async (req, res) => {
  try {
    const wo = await WorkOrder.findById(req.params.id)
      .populate('bomId', 'bomId product version components overheadPct labourCost')
      .populate('oemBrand', 'brandId name code color')
      .populate('materialConsumption.vendorId', 'vendorId companyName')
      .populate('materialConsumption.oemBrand', 'brandId name');
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, data: wo });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── CREATE ────────────────────────────────────────────────────────────────────
export const createWorkOrder = async (req, res) => {
  try {
    const { product, bomId, qty } = req.body;
    if (!product?.trim()) return res.status(400).json({ success: false, message: 'Product is required' });
    if (!qty || qty < 1)  return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });

    let plannedCost = 0;
    if (bomId) {
      const bom = await BOM.findById(bomId);
      if (!bom) return res.status(400).json({ success: false, message: 'Referenced BOM not found' });
      const mat = bom.components.reduce((s, c) => s + c.qty * (1 + (c.scrapFactor || 0) / 100) * (c.unitCost || 0), 0);
      plannedCost = (mat * (1 + (bom.overheadPct || 0) / 100) + (bom.labourCost || 0)) * qty;
    }

    const woId = await generateWoId();
    const wo = await WorkOrder.create({ woId, plannedCost, ...req.body, status: 'Pending' });
    const populated = await wo.populate('bomId', 'bomId product version');
    res.status(201).json({ success: true, message: 'Work order created', data: populated });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── UPDATE header ─────────────────────────────────────────────────────────────
export const updateWorkOrder = async (req, res) => {
  try {
    const wo = await WorkOrder.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('bomId', 'bomId product version')
      .populate('oemBrand', 'brandId name code color');
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, message: 'Work order updated', data: wo });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── RELEASE WO — populate material consumption from BOM ───────────────────────
// PATCH /api/workorders/:id/release
export const releaseWorkOrder = async (req, res) => {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (wo.status !== 'Pending') return res.status(400).json({ success: false, message: 'Only Pending WOs can be released' });
    if (!wo.bomId) return res.status(400).json({ success: false, message: 'WO must have a BOM to be released' });

    const bom = await BOM.findById(wo.bomId);
    if (!bom) return res.status(400).json({ success: false, message: 'BOM not found' });

    // Build material consumption plan from BOM components
    wo.materialConsumption = bom.components.map(c => ({
      itemName:    c.itemName,
      itemCode:    c.itemCode,
      plannedQty:  Math.round(c.qty * (1 + (c.scrapFactor || 0) / 100) * wo.qty * 1000) / 1000,
      consumedQty: 0,
      unit:        c.unit,
      vendorId:    c.vendorId || null,
      oemBrand:    c.oemBrand || null,
      unitCost:    c.unitCost || 0,
    }));

    wo.status     = 'Released';
    wo.actualStart = new Date();
    await wo.save();

    res.json({ success: true, message: 'Work order released — material plan created', data: wo });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── UPDATE PROGRESS ───────────────────────────────────────────────────────────
export const updateProgress = async (req, res) => {
  try {
    const { produced } = req.body;
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });

    const newProduced = Math.min(parseInt(produced), wo.qty);
    wo.produced = newProduced;
    wo.status   = newProduced >= wo.qty ? 'QC Pending' : 'In-Progress';
    if (wo.status === 'In-Progress' && !wo.actualStart) wo.actualStart = new Date();
    await wo.save();

    res.json({ success: true, message: 'Progress updated', data: wo });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── RECORD MATERIAL CONSUMPTION ───────────────────────────────────────────────
// PATCH /api/workorders/:id/consume
// body: { consumptions: [{ consumptionId, consumedQty, batchNo, isAlternate, alternateFor, alternateItemName }] }
export const recordConsumption = async (req, res) => {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (!['Released', 'In-Progress', 'WIP'].includes(wo.status))
      return res.status(400).json({ success: false, message: 'WO must be Released or In-Progress to record consumption' });

    const { consumptions = [] } = req.body;
    for (const c of consumptions) {
      const line = wo.materialConsumption.id(c.consumptionId);
      if (!line) continue;
      line.consumedQty  = parseFloat(c.consumedQty) || 0;
      line.batchNo      = c.batchNo || '';
      line.isAlternate  = c.isAlternate || false;
      line.alternateFor = c.alternateFor || '';
      if (c.isAlternate && c.alternateItemName) line.itemName = c.alternateItemName;
      line.consumedAt   = new Date();
      line.consumedBy   = c.consumedBy || '';
    }

    wo.status = 'In-Progress';
    await wo.save();
    res.json({ success: true, message: 'Consumption recorded', data: wo });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── DEDUCT INVENTORY ──────────────────────────────────────────────────────────
// POST /api/workorders/:id/deduct-inventory
// Deducts consumed quantities from InventoryItem stock
export const deductInventory = async (req, res) => {
  try {
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    if (wo.inventoryDeducted) return res.status(400).json({ success: false, message: 'Inventory already deducted for this WO' });

    const errors = [];
    let totalActualCost = 0;

    for (const line of wo.materialConsumption) {
      const qty = line.consumedQty || line.plannedQty;
      if (!qty) continue;

      // Find inventory item by itemCode or itemName
      const invItem = await InventoryItem.findOne(
        line.itemCode
          ? { $or: [{ sku: line.itemCode }, { name: new RegExp(line.itemName, 'i') }] }
          : { name: new RegExp(line.itemName, 'i') }
      );

      if (!invItem) {
        errors.push(`Item not found in inventory: ${line.itemName}`);
        continue;
      }

      if (invItem.qty < qty) {
        errors.push(`Insufficient stock for ${line.itemName}: need ${qty}, have ${invItem.qty}`);
        continue;
      }

      invItem.qty -= qty;
      await invItem.save();
      totalActualCost += qty * (line.unitCost || 0);
    }

    wo.inventoryDeducted = true;
    wo.actualCost = totalActualCost;
    wo.status = 'WIP';
    await wo.save();

    res.json({
      success: true,
      message: errors.length ? `Inventory deducted with ${errors.length} warning(s)` : 'Inventory deducted successfully',
      warnings: errors,
      data: wo,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── QC RESULT ─────────────────────────────────────────────────────────────────
// PATCH /api/workorders/:id/qc
export const recordQC = async (req, res) => {
  try {
    const { passedQty, rejectedQty, defectType, inspectedBy, remarks } = req.body;
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });

    wo.qcResult = { passedQty: passedQty || 0, rejectedQty: rejectedQty || 0, defectType, inspectedBy, inspectedAt: new Date(), remarks };
    wo.produced  = passedQty || 0;
    wo.rejected  = rejectedQty || 0;
    wo.status    = (passedQty || 0) >= wo.qty ? 'Completed' : 'QC Pending';
    if (wo.status === 'Completed') wo.actualEnd = new Date();
    await wo.save();

    res.json({ success: true, message: 'QC result recorded', data: wo });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── DELETE ────────────────────────────────────────────────────────────────────
export const deleteWorkOrder = async (req, res) => {
  try {
    const wo = await WorkOrder.findByIdAndDelete(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    res.json({ success: true, message: 'Work order deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
