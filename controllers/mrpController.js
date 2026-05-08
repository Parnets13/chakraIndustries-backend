import MRPRun      from '../models/MRPRun.js';
import WorkOrder   from '../models/WorkOrder.js';
import BOM         from '../models/BOM.js';
import InventoryItem from '../models/InventoryItem.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import PurchaseRequisition from '../models/PurchaseRequisition.js';
import OEMProduct  from '../models/OEMProduct.js';

async function generateMrpId() {
  const last = await MRPRun.findOne().sort({ createdAt: -1 }).select('mrpId');
  let n = 1;
  if (last?.mrpId) { const m = last.mrpId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  return `MRP-${String(n).padStart(4, '0')}`;
}

async function generatePrId() {
  const last = await PurchaseRequisition.findOne().sort({ createdAt: -1 }).select('prId');
  let n = 1;
  if (last?.prId) { const m = last.prId.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  return `PR-${String(n).padStart(4, '0')}`;
}

// ── GET all MRP runs ──────────────────────────────────────────────────────────
export const getAllMRPRuns = async (req, res) => {
  try {
    const runs = await MRPRun.find().sort({ createdAt: -1 }).select('-lines');
    res.json({ success: true, data: runs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET single MRP run ────────────────────────────────────────────────────────
export const getMRPRunById = async (req, res) => {
  try {
    const run = await MRPRun.findById(req.params.id)
      .populate('lines.suggestedVendorId', 'vendorId companyName')
      .populate('lines.suggestedOemBrand', 'brandId name code');
    if (!run) return res.status(404).json({ success: false, message: 'MRP run not found' });
    res.json({ success: true, data: run });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── RUN MRP ───────────────────────────────────────────────────────────────────
// POST /api/mrp/run
// body: { workOrderIds: [...], description, runBy }
export const runMRP = async (req, res) => {
  try {
    const { workOrderIds = [], description = '', runBy = '' } = req.body;

    if (workOrderIds.length === 0)
      return res.status(400).json({ success: false, message: 'At least one Work Order is required' });

    const mrpId = await generateMrpId();
    const run = await MRPRun.create({ mrpId, description, runBy, workOrders: workOrderIds, status: 'Running' });

    // ── Step 1: Explode BOMs for all WOs ──────────────────────────────────────
    const demandMap = new Map(); // itemCode/itemName → { qty, unit, unitCost, vendorId, oemBrand }

    const wos = await WorkOrder.find({ _id: { $in: workOrderIds } }).populate('bomId');
    const bomIds = [];

    for (const wo of wos) {
      if (!wo.bomId) continue;
      bomIds.push(wo.bomId._id);
      const bom = wo.bomId;

      for (const c of bom.components) {
        const key = c.itemCode || c.itemName;
        const needed = c.qty * (1 + (c.scrapFactor || 0) / 100) * wo.qty;
        if (demandMap.has(key)) {
          demandMap.get(key).grossRequirement += needed;
        } else {
          demandMap.set(key, {
            itemName:    c.itemName,
            itemCode:    c.itemCode || '',
            unit:        c.unit,
            grossRequirement: needed,
            unitCost:    c.unitCost || 0,
            vendorId:    c.vendorId || null,
            oemBrand:    c.oemBrand || null,
            leadTimeDays: 0,
          });
        }
      }
    }

    // ── Step 2: Check inventory & open POs ────────────────────────────────────
    const lines = [];
    let itemsWithShortage = 0;
    let estimatedCost = 0;

    for (const [key, demand] of demandMap) {
      // Current stock
      const invItems = await InventoryItem.find({
        $or: [
          { sku: demand.itemCode || '__NONE__' },
          { name: new RegExp(demand.itemName, 'i') },
        ],
      });
      const onHandQty = invItems.reduce((s, i) => s + (i.qty || 0), 0);

      // Open POs (scheduled receipts)
      const openPOs = await PurchaseOrder.find({
        status: { $in: ['Approved', 'Pending'] },
        'items.name': new RegExp(demand.itemName, 'i'),
      });
      const scheduledReceipts = openPOs.reduce((s, po) => {
        const item = po.items.find(i => i.name.toLowerCase().includes(demand.itemName.toLowerCase()));
        return s + (item?.qty || 0);
      }, 0);

      const netRequirement = Math.max(0, demand.grossRequirement - onHandQty - scheduledReceipts);
      const action = netRequirement > 0 ? 'Create PR' : 'No Action';

      if (netRequirement > 0) itemsWithShortage++;
      estimatedCost += netRequirement * demand.unitCost;

      // Try to find best OEM/vendor for this item
      let suggestedVendorId = demand.vendorId;
      let suggestedOemBrand = demand.oemBrand;
      let estimatedLeadDays = demand.leadTimeDays;

      if (!suggestedVendorId && !suggestedOemBrand) {
        const oemProd = await OEMProduct.findOne({
          productName: new RegExp(demand.itemName, 'i'),
          status: 'Active',
        }).sort({ autoSelectPriority: -1, unitPrice: 1 }).populate('oemBrand', '_id');
        if (oemProd) {
          suggestedOemBrand = oemProd.oemBrand?._id || null;
          estimatedLeadDays = oemProd.leadTimeDays || 0;
          if (!demand.unitCost) demand.unitCost = oemProd.unitPrice || 0;
        }
      }

      lines.push({
        itemName:          demand.itemName,
        itemCode:          demand.itemCode,
        unit:              demand.unit,
        grossRequirement:  Math.round(demand.grossRequirement * 1000) / 1000,
        scheduledReceipts: Math.round(scheduledReceipts * 1000) / 1000,
        onHandQty:         Math.round(onHandQty * 1000) / 1000,
        netRequirement:    Math.round(netRequirement * 1000) / 1000,
        suggestedOrderQty: Math.ceil(netRequirement),
        suggestedVendorId,
        suggestedOemBrand,
        estimatedUnitCost: demand.unitCost,
        estimatedLeadDays,
        action,
        status: 'Open',
      });
    }

    // ── Step 3: Save results ──────────────────────────────────────────────────
    run.lines             = lines;
    run.boms              = bomIds;
    run.totalItems        = lines.length;
    run.itemsWithShortage = itemsWithShortage;
    run.estimatedCost     = Math.round(estimatedCost * 100) / 100;
    run.status            = 'Completed';
    await run.save();

    res.status(201).json({ success: true, message: `MRP run completed — ${itemsWithShortage} shortage(s) found`, data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── CREATE PRs FROM MRP ───────────────────────────────────────────────────────
// POST /api/mrp/:id/create-prs
// body: { lineIds: [...], department, requestedBy }
export const createPRsFromMRP = async (req, res) => {
  try {
    const { lineIds = [], department = 'Production', requestedBy = 'MRP System' } = req.body;
    const run = await MRPRun.findById(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: 'MRP run not found' });

    const targetLines = run.lines.filter(l => lineIds.includes(String(l._id)) && l.action === 'Create PR' && l.status === 'Open');
    if (targetLines.length === 0) return res.status(400).json({ success: false, message: 'No eligible lines selected' });

    // Group into one PR
    const prId = await generatePrId();
    const items = targetLines.map(l => ({
      name:           l.itemName,
      qty:            l.suggestedOrderQty,
      unit:           l.unit,
      estimatedPrice: l.estimatedUnitCost,
    }));
    const totalValue = items.reduce((s, i) => s + i.qty * i.estimatedPrice, 0);

    const pr = await PurchaseRequisition.create({
      prId,
      department,
      requestedBy,
      priority: 'Urgent',
      remarks:  `Auto-generated from MRP Run ${run.mrpId}`,
      items,
      totalValue,
      status: 'Pending',
    });

    // Mark lines as PR Created
    for (const line of targetLines) {
      line.prId   = prId;
      line.status = 'PR Created';
    }
    run.totalPRsCreated += 1;
    await run.save();

    res.status(201).json({ success: true, message: `PR ${prId} created with ${items.length} item(s)`, data: { pr, mrpRun: run } });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── DELETE MRP run ────────────────────────────────────────────────────────────
export const deleteMRPRun = async (req, res) => {
  try {
    const run = await MRPRun.findByIdAndDelete(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: 'MRP run not found' });
    res.json({ success: true, message: 'MRP run deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
