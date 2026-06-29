import WorkOrder  from '../models/WorkOrder.js';
import BOM        from '../models/BOM.js';
import InventoryItem from '../models/InventoryItem.js';
import StockMovement from '../models/StockMovement.js';
import DefectiveStock from '../models/DefectiveStock.js';
import LossTracking from '../models/LossTracking.js';

async function generateWoId() {
  const last = await WorkOrder.findOne().sort({ createdAt: -1 }).select('woId');
  let n = 1;
  if (last?.woId) { const m = last.woId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `WO-${String(n).padStart(4, '0')}`;
  while (await WorkOrder.findOne({ woId: id })) { n++; id = `WO-${String(n).padStart(4, '0')}`; }
  return id;
}

async function generateMovementId() {
  const last = await StockMovement.findOne().sort({ createdAt: -1 }).select('movementId');
  let n = 1;
  if (last?.movementId) { const m = last.movementId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `MV-${String(n).padStart(3, '0')}`;
  while (await StockMovement.findOne({ movementId: id })) { n++; id = `MV-${String(n).padStart(3, '0')}`; }
  return id;
}

async function generateDefectId() {
  const last = await DefectiveStock.findOne().sort({ createdAt: -1 }).select('defectId');
  let n = 1;
  if (last?.defectId) { const m = last.defectId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `DEF-${String(n).padStart(5, '0')}`;
  while (await DefectiveStock.findOne({ defectId: id })) { n++; id = `DEF-${String(n).padStart(5, '0')}`; }
  return id;
}

function finishedGoodsSku(product) {
  return `FG-${String(product || 'PRODUCT').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toUpperCase()}`;
}

async function updateInventoryStatus(item) {
  item.status = item.qty === 0 ? 'Dead' : item.qty < item.minQty ? 'Critical' : 'Active';
  await item.save();
}

// ── GET all ───────────────────────────────────────────────────────────────────
export const getAllWorkOrders = async (req, res) => {
  try {
    const { status, oemBrand } = req.query;
    const filter = {};
    if (status)   filter.status = status;
    if (oemBrand) filter.oemBrand = oemBrand;

    const wos = await WorkOrder.find(filter)
      .populate({
        path: 'bomId',
        select: 'bomId product version components overheadPct labourCost status'
      })
      .populate('productItemMasterId', 'itemId sku name unit description')
      .populate('oemBrand', 'brandId name code color status')
      .populate({ path: 'materialConsumption.vendorId', select: 'companyName contactName' })
      .sort({ createdAt: -1 });
    
    const data = wos.map(wo => {
      const woData = wo.toObject();
      
      // Calculate efficiency percentage
      if (woData.qty > 0) {
        woData.efficiency = Math.round((woData.produced / woData.qty) * 100);
      }
      
      return woData;
    });
    
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET single ────────────────────────────────────────────────────────────────
export const getWorkOrderById = async (req, res) => {
  try {
    const wo = await WorkOrder.findById(req.params.id)
      .populate('productItemMasterId', 'itemId sku name unit description')
      .populate({
        path: 'bomId',
        select: 'bomId product version components overheadPct labourCost status',
        populate: [
          {
            path: 'components.vendorId',
            select: 'vendorId companyName'
          },
          {
            path: 'components.oemBrand',
            select: 'brandId name code'
          }
        ]
      })
      .populate('oemBrand', 'brandId name code color status')
      .populate({
        path: 'materialConsumption.vendorId',
        select: 'vendorId companyName'
      })
      .populate({
        path: 'materialConsumption.oemBrand',
        select: 'brandId name code'
      });
    
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });
    
    const woData = wo.toObject();
    
    // Enhance material consumption with calculated costs
    if (woData.materialConsumption) {
      woData.materialConsumption = woData.materialConsumption.map(mat => ({
        ...mat,
        totalCost: Math.round((mat.plannedQty || 0) * (mat.unitCost || 0) * 100) / 100,
        consumedCost: Math.round((mat.consumedQty || 0) * (mat.unitCost || 0) * 100) / 100,
      }));
    }
    
    res.json({ success: true, data: woData });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── CREATE ────────────────────────────────────────────────────────────────────
export const createWorkOrder = async (req, res) => {
  try {
    const {
      productItemMasterId, product, bomId, qty, woId, shift, startDate, endDate, priority, remarks,
      oemBrand, oemProduct, salesOrderId, productionLine, machine, assignedTeam, supervisor
    } = req.body;
    
    console.log('Create WO Request Body:', req.body);
    
    // Validate required fields
    if (!product || !product.trim()) {
      return res.status(400).json({ success: false, message: 'Product name is required' });
    }
    if (!qty || parseInt(qty) < 1) {
      return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
    }
    if (!startDate) {
      return res.status(400).json({ success: false, message: 'Start date is required' });
    }
    
    // Auto-generate woId if not provided
    const finalWoId = woId || await generateWoId();
    
    // Parse startDate properly
    const parsedStartDate = new Date(startDate);
    if (isNaN(parsedStartDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid start date format' });
    }
    
    const parsedEndDate = endDate ? new Date(endDate) : parsedStartDate;

    let plannedCost = 0;
    if (bomId) {
      const bom = await BOM.findById(bomId);
      if (!bom) return res.status(400).json({ success: false, message: 'Referenced BOM not found' });
      const mat = bom.components.reduce((s, c) => s + c.qty * (1 + (c.scrapFactor || 0) / 100) * (c.unitCost || 0), 0);
      plannedCost = (mat * (1 + (bom.overheadPct || 0) / 100) + (bom.labourCost || 0)) * parseInt(qty);
    }

    const wo = await WorkOrder.create({
      woId: finalWoId,
      productItemMasterId: productItemMasterId || null,
      product: product.trim(),
      bomId: bomId || null,
      oemBrand: oemBrand || null,
      oemProduct: oemProduct || null,
      salesOrderId: salesOrderId || null,
      qty: parseInt(qty),
      shift: shift || 'General',
      startDate: parsedStartDate,
      endDate: parsedEndDate,
      priority: priority || 'Normal',
      productionLine: productionLine || '',
      machine: machine || '',
      assignedTeam: assignedTeam || '',
      supervisor: supervisor || '',
      remarks: remarks || '',
      plannedCost,
      status: 'Pending'
    });
    
    const populated = await wo.populate('bomId', 'bomId product version');
    res.status(201).json({ success: true, message: 'Work order created', data: populated });
  } catch (err) {
    console.error('Create Work Order Error:', err.message, err.stack);
    res.status(400).json({ success: false, message: err.message });
  }
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

// ── RELEASE WO — populate material consumption from BOM and auto-deduct inventory ───────────────────────
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
      itemMasterId: c.itemMasterId,
      itemName:    c.itemName,
      itemCode:    c.itemCode,
      plannedQty:  Math.round(c.qty * (1 + (c.scrapFactor || 0) / 100) * wo.qty * 1000) / 1000,
      consumedQty: 0,
      unit:        c.unit,
      vendorId:    c.vendorId || null,
      oemBrand:    c.oemBrand || null,
      unitCost:    c.unitCost || 0,
    }));

    // ✅ AUTO-DEDUCT INVENTORY
    const errors = [];
    let totalPlannedCost = 0;

    for (const line of wo.materialConsumption) {
      const qty = line.plannedQty;
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
      await updateInventoryStatus(invItem);
      totalPlannedCost += qty * (line.unitCost || 0);

      // Create stock movement record
      const movementId = await generateMovementId();
      await StockMovement.create({
        movementId,
        type: 'Issued to Production',
        sku: line.itemCode || line.itemName,
        name: line.itemName,
        qty: -qty,
        from: invItem.warehouse,
        to: `Production ${wo.woId}`,
        ref: wo.woId,
        notes: `Raw materials issued for WO ${wo.woId}`,
      });
    }

    wo.status     = 'Released';
    wo.inventoryDeducted = true;
    wo.plannedCost = totalPlannedCost;
    wo.actualStart = new Date();
    await wo.save();

    res.json({
      success: true,
      message: errors.length ? `WO released with ${errors.length} warning(s) - inventory deducted` : 'Work order released and inventory deducted successfully',
      warnings: errors,
      data: wo
    });
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
    
    // ✅ Calculate efficiency
    wo.efficiency = Math.round((newProduced / wo.qty) * 100);
    
    // ✅ Calculate WIP
    wo.wip = wo.qty - newProduced - wo.rejected;
    
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
      await updateInventoryStatus(invItem);
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

// ── QC result ─────────────────────────────────────────────────────────────────
// PATCH /api/workorders/:id/qc
export const recordQC = async (req, res) => {
  try {
    const { passedQty, reworkQty, rejectedQty, defectType, inspectedBy, remarks } = req.body;
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });

    wo.qcResult = { passedQty: passedQty || 0, reworkQty: reworkQty || 0, rejectedQty: rejectedQty || 0, defectType, inspectedBy, inspectedAt: new Date(), remarks };
    wo.produced  = passedQty || 0;
    wo.rejected  = rejectedQty || 0;
    // If there's rework, keep status as QC Pending; otherwise mark as Completed if passed qty meets WO qty
    wo.status    = (reworkQty || 0) > 0 ? 'QC Pending' : ((passedQty || 0) >= wo.qty ? 'Completed' : 'QC Pending');
    if (wo.status === 'Completed') wo.actualEnd = new Date();

    if (!wo.finishedGoodsPosted && (passedQty || 0) > 0) {
      const sku = finishedGoodsSku(wo.product);
      const existingFg = await InventoryItem.findOne({ sku, warehouse: 'FG-01' });

      if (existingFg) {
        existingFg.qty += passedQty || 0;
        existingFg.lastReceivedAt = new Date();
        await updateInventoryStatus(existingFg);
      } else {
        await InventoryItem.create({
          sku,
          name: wo.product,
          qty: passedQty || 0,
          unit: 'Nos',
          warehouse: 'FG-01',
          minQty: 0,
          lastReceivedAt: new Date(),
          status: 'Active',
        });
      }

      const movementId = await generateMovementId();
      await StockMovement.create({
        movementId,
        type: 'Inward',
        sku,
        name: wo.product,
        qty: passedQty || 0,
        from: `Production ${wo.woId}`,
        to: 'FG-01',
        ref: wo.woId,
        notes: 'Finished goods posted after QC approval',
      });

      wo.finishedGoodsPosted = true;
      wo.finishedGoodsSku = sku;
    }

    if (!wo.defectiveStockPosted && (rejectedQty || 0) > 0) {
      const defectId = await generateDefectId();
      await DefectiveStock.create({
        defectId,
        sku: wo.finishedGoodsSku || finishedGoodsSku(wo.product),
        itemName: wo.product,
        quantity: rejectedQty || 0,
        defectType: defectType || 'Other',
        source: 'Production',
        stage: 'QC Hold',
        warehouse: 'Production',
        remarks: remarks || `Rejected from ${wo.woId}`,
      });
      wo.defectiveStockPosted = true;
    }

    await wo.save();

    res.json({ success: true, message: 'QC result recorded and finished goods updated', data: wo });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── RECORD MATERIAL WASTAGE ───────────────────────────────────────────────────
// PATCH /api/workorders/:id/wastage
// body: { consumptionId, wastedQty, wastageReason }
export const recordWastage = async (req, res) => {
  try {
    const { consumptionId, wastedQty, wastageReason } = req.body;
    const wo = await WorkOrder.findById(req.params.id);
    if (!wo) return res.status(404).json({ success: false, message: 'Work order not found' });

    const line = wo.materialConsumption.id(consumptionId);
    if (!line) {
      return res.status(400).json({ success: false, message: 'Invalid consumption line' });
    }

    line.wastedQty     = parseFloat(wastedQty) || 0;
    line.wastageReason = wastageReason || '';
    line.wastedAt      = line.wastedQty > 0 ? new Date() : null;

    // Create loss tracking record
    if (line.wastedQty > 0) {
      const lossId = `LOSS-${Date.now()}`;
      await LossTracking.create({
        lossId,
        mrId: wo.woId,
        supplierName: 'Internal Production',
        products: [{
          productName: line.itemName,
          skuCode: line.itemCode,
          returnQty: line.wastedQty,
          damagedQty: line.wastedQty,
          unitRate: line.unitCost
        }],
        invoiceType: 'Production Loss',
        remarks: `Wastage from WO ${wo.woId}: ${wastageReason}`
      }).catch(err => console.log('Loss tracking note:', err.message));
    }

    await wo.save();

    // Return with vendor populated so frontend can show vendor name immediately
    const populated = await WorkOrder.findById(wo._id)
      .populate({ path: 'materialConsumption.vendorId', select: 'companyName contactName' });
    res.json({ success: true, message: 'Wastage recorded', data: populated });
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
