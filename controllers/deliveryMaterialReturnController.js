// ─── Delivery App – Material Returns Controller ──────────────────────────────
// Powers the "Material Returns – Docket Identification & Returns Management"
// module in the ChakraDeliver mobile app.
//
// Reuses the existing MaterialReturn model and the DeliverySchedule / DocketTracking
// data. One MaterialReturn document is created per returned item (matching the
// existing single-product-per-record convention in the ERP), and all items from a
// single submission share a `returnGroupId` so they are grouped as one return.

import mongoose from 'mongoose';
import MaterialReturn from '../models/MaterialReturn.js';
import DeliverySchedule from '../models/DeliverySchedule.js';
import DocketTracking from '../models/DocketTracking.js';
import Invoice from '../models/Invoice.js';

const RETURN_REASONS = [
  'Damaged', 'Wrong Material', 'Excess Material', 'Customer Rejection',
  'Defective', 'Replacement', 'Warranty Return', 'Other',
];

// ── ID generation ─────────────────────────────────────────────────────────────
// Sequential MR number per year: MR-YYYY-00001  (matches spec example)
const genMrNumber = async () => {
  const year = new Date().getFullYear();
  const prefix = `MR-${year}-`;
  const last = await MaterialReturn.findOne({ mrId: new RegExp(`^${prefix}`) })
    .sort({ mrId: -1 })
    .select('mrId')
    .lean();
  let next = 1;
  if (last?.mrId) {
    const n = parseInt(last.mrId.split('-').pop(), 10);
    if (!isNaN(n)) next = n + 1;
  }
  // Guard against collision under concurrency
  let candidate = `${prefix}${String(next).padStart(5, '0')}`;
  // eslint-disable-next-line no-await-in-loop
  while (await MaterialReturn.findOne({ mrId: candidate }).lean()) {
    next += 1;
    candidate = `${prefix}${String(next).padStart(5, '0')}`;
  }
  return candidate;
};

const genGroupId = () => `MRG-${new Date().getFullYear()}-${Date.now().toString(36).toUpperCase()}`;

// ── Helper: compute previously returned qty for a delivery + item ─────────────
// Sums returnQty across all existing MaterialReturn records for the same
// deliveryScheduleId + item (matched by sku when available, else productName).
const getPreviouslyReturnedMap = async (scheduleId) => {
  const existing = await MaterialReturn.find({
    deliveryScheduleId: scheduleId,
    // Exclude rejected returns from the "used up" quota — a rejected return
    // did not actually consume returnable quantity.
    approvalStatus: { $ne: 'Rejected' },
  }).select('skuCode productSku productName returnQty').lean();

  const map = {}; // key -> total returned
  for (const r of existing) {
    const key = (r.skuCode || r.productSku || r.productName || '').trim().toLowerCase();
    if (!key) continue;
    map[key] = (map[key] || 0) + (Number(r.returnQty) || 0);
  }
  return map;
};

const itemKey = (item) => (item.sku || item.skuCode || item.itemName || item.productName || '').trim().toLowerCase();

// ── GET /delivery-agent/material-returns/reasons ──────────────────────────────
export const getReturnReasons = async (_req, res) => {
  res.json({ success: true, data: RETURN_REASONS });
};

// ── GET /delivery-agent/material-returns/search-dockets?query=&from=&to= ──────
// Search delivered dockets/deliveries by docket no, invoice no, customer, date.
export const searchDockets = async (req, res) => {
  try {
    const { query = '', customer = '', from = '', to = '' } = req.query;

    // Only delivered schedules are returnable
    const filter = { status: 'Delivered' };

    if (query.trim()) {
      const rx = new RegExp(query.trim(), 'i');
      filter.$or = [
        { scheduleId: rx },
        { orderId: rx },
        { quotationId: rx },
        { client: rx },
      ];
    }
    if (customer.trim()) filter.client = new RegExp(customer.trim(), 'i');
    if (from || to) {
      filter.deliveryDate = {};
      if (from) filter.deliveryDate.$gte = new Date(from);
      if (to) {
        const end = new Date(to);
        end.setHours(23, 59, 59, 999);
        filter.deliveryDate.$lte = end;
      }
    }

    const list = await DeliverySchedule.find(filter)
      .sort({ deliveryDate: -1, createdAt: -1 })
      .limit(50)
      .lean();

    const data = list.map((d) => ({
      _id: d._id,
      docketNumber: d.scheduleId,
      orderId: d.orderId || '',
      customer: d.client,
      clientId: d.clientId || '',
      deliveryDate: d.deliveredAt || d.deliveryDate,
      totalItems: d.totalItems || (d.items || []).length,
      totalQty: d.totalQty || (d.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0),
      status: d.status,
    }));

    res.json({ success: true, data });
  } catch (err) {
    console.error('[searchDockets]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /delivery-agent/material-returns/docket/:scheduleId/returnable ─────────
// Load a docket's original delivered items + previously returned + returnable qty.
export const getReturnableItems = async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const delivery = await DeliverySchedule.findOne({
      $or: [{ scheduleId }, { _id: mongoose.isValidObjectId(scheduleId) ? scheduleId : undefined }].filter(Boolean),
    }).lean();

    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Docket / delivery not found' });
    }

    // Try to link an invoice number if one exists for this order
    let invoiceNo = '';
    if (delivery.orderId) {
      const inv = await Invoice.findOne({
        $or: [{ purchaseOrderRef: delivery.orderId }, { salesOrderId: delivery.orderId }],
      }).select('invoiceNo').lean();
      invoiceNo = inv?.invoiceNo || '';
    }

    const prevMap = await getPreviouslyReturnedMap(delivery.scheduleId);

    const items = (delivery.items || []).map((it) => {
      const key = itemKey(it);
      const deliveredQty = Number(it.qty) || 0;
      const previouslyReturned = prevMap[key] || 0;
      const returnableQty = Math.max(0, deliveredQty - previouslyReturned);
      return {
        sku: it.sku || '',
        itemName: it.itemName || '',
        unitPrice: Number(it.unitPrice) || 0,
        deliveredQty,
        previouslyReturnedQty: previouslyReturned,
        returnableQty,
      };
    });

    res.json({
      success: true,
      data: {
        docketNumber: delivery.scheduleId,
        orderId: delivery.orderId || '',
        invoiceNo,
        customer: delivery.client,
        clientId: delivery.clientId || '',
        deliveryDate: delivery.deliveredAt || delivery.deliveryDate,
        status: delivery.status,
        items,
      },
    });
  } catch (err) {
    console.error('[getReturnableItems]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /delivery-agent/material-returns ─────────────────────────────────────
// Create a material return (one or more items) against a delivered docket.
// Body: { scheduleId, items: [{ sku, itemName, unitPrice, deliveredQty, returnQty,
//         returnReason, remarks, condition: {good,damaged,repairable,scrap} }] }
export const createMaterialReturn = async (req, res) => {
  const session = await mongoose.startSession();
  try {
    const body = req.body || {};
    const { scheduleId, items = [], submit = false } = body;

    if (!scheduleId) {
      return res.status(400).json({ success: false, message: 'Docket (scheduleId) is required' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one return item is required' });
    }

    const delivery = await DeliverySchedule.findOne({ scheduleId }).lean();
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Docket / delivery not found' });
    }

    // Build a lookup of the delivered items for validation
    const deliveredMap = {};
    (delivery.items || []).forEach((it) => { deliveredMap[itemKey(it)] = it; });

    const prevMap = await getPreviouslyReturnedMap(scheduleId);

    // ── Validate every line before writing anything ──────────────────────────
    const validated = [];
    for (const line of items) {
      const key = itemKey(line);
      const delivered = deliveredMap[key];
      if (!delivered) {
        return res.status(400).json({ success: false, message: `Item "${line.itemName || line.sku}" is not part of this docket` });
      }

      const returnQty = Number(line.returnQty) || 0;
      if (returnQty <= 0) continue; // skip lines with no return qty

      const deliveredQty = Number(delivered.qty) || 0;
      const previouslyReturned = prevMap[key] || 0;
      const returnableQty = Math.max(0, deliveredQty - previouslyReturned);

      if (returnQty < 0) {
        return res.status(400).json({ success: false, message: `Return qty cannot be negative for "${delivered.itemName}"` });
      }
      if (returnQty > returnableQty) {
        return res.status(400).json({
          success: false,
          message: `Return qty (${returnQty}) exceeds returnable qty (${returnableQty}) for "${delivered.itemName}". Delivered=${deliveredQty}, previously returned=${previouslyReturned}.`,
        });
      }
      if (!line.returnReason || !RETURN_REASONS.includes(line.returnReason)) {
        return res.status(400).json({ success: false, message: `A valid return reason is required for "${delivered.itemName}"` });
      }

      // Condition breakdown must sum to returnQty
      const cond = line.condition || {};
      const good = Number(cond.good) || 0;
      const damaged = Number(cond.damaged) || 0;
      const repairable = Number(cond.repairable) || 0;
      const scrap = Number(cond.scrap) || 0;
      const condTotal = good + damaged + repairable + scrap;
      if (condTotal !== returnQty) {
        return res.status(400).json({
          success: false,
          message: `Condition quantities (${condTotal}) must equal return qty (${returnQty}) for "${delivered.itemName}"`,
        });
      }

      validated.push({
        delivered, line, returnQty, deliveredQty, previouslyReturned,
        cond: { good, damaged, repairable, scrap },
      });
    }

    if (validated.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid return items with quantity > 0' });
    }

    // ── Create records inside a transaction ──────────────────────────────────
    const returnGroupId = genGroupId();
    const agent = req.user;
    const created = [];

    await session.withTransaction(async () => {
      for (const v of validated) {
        const mrId = await genMrNumber();
        const unitPrice = Number(v.line.unitPrice ?? v.delivered.unitPrice) || 0;
        const value = +(unitPrice * v.returnQty).toFixed(2);

        const [doc] = await MaterialReturn.create([{
          mrId,
          returnRequestId: mrId,
          returnGroupId,
          deliveryScheduleId: scheduleId,
          docketId: undefined, // assigned on approval
          returnDate: new Date(),

          // Party
          customerName: delivery.client || '',
          supplierName: delivery.client || 'N/A', // required field on the model

          // Product
          productName: v.delivered.itemName || '',
          skuCode: v.delivered.sku || '',
          productSku: v.delivered.sku || '',
          returnQty: v.returnQty,
          orderedQty: v.deliveredQty,
          originalDeliveredQty: v.deliveredQty,
          previouslyReturnedQty: v.previouslyReturned,
          unitPrice,
          value,

          // Reason & condition
          returnReason: v.line.returnReason,
          reason: v.line.returnReason,
          itemRemarks: v.line.remarks || '',
          remarks: v.line.remarks || '',
          conditionBreakdown: v.cond,

          // Status / stage
          approvalStatus: 'Pending',
          currentStage: submit ? 'REQUEST_RAISED' : 'REQUEST_RAISED',
          warehouseStatus: 'Pending',
          qcStatus: 'Pending',
          financeStatus: 'Pending',

          // Metadata
          orderNo: delivery.orderId || '',
          requestedBy: agent?.name || 'Delivery Agent',
          createdByAgentId: agent?._id || null,
          sourceApp: 'delivery_app',

          stageTimeline: [{
            stage: 'REQUEST_RAISED',
            user: agent?.name || 'Delivery Agent',
            remarks: submit ? 'Return submitted from Delivery app' : 'Return draft created from Delivery app',
            status: 'Completed',
            timestamp: new Date(),
          }],
        }], { session });

        created.push(doc);
      }
    });

    res.status(201).json({
      success: true,
      message: `Material return ${returnGroupId} created with ${created.length} item(s)`,
      data: {
        returnGroupId,
        returns: created,
      },
    });
  } catch (err) {
    console.error('[createMaterialReturn]', err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    session.endSession();
  }
};

// ── GET /delivery-agent/material-returns ──────────────────────────────────────
// List returns created via the delivery app, grouped by returnGroupId.
// Supports search + status/reason filters + pagination.
export const listMaterialReturns = async (req, res) => {
  try {
    const {
      search = '', status = '', reason = '', customer = '',
      page = 1, limit = 20,
    } = req.query;

    const filter = { sourceApp: 'delivery_app' };
    if (status) filter.approvalStatus = status;
    if (reason) filter.returnReason = reason;
    if (customer) filter.customerName = new RegExp(customer, 'i');
    if (search.trim()) {
      const rx = new RegExp(search.trim(), 'i');
      filter.$or = [
        { mrId: rx },
        { deliveryScheduleId: rx },
        { docketId: rx },
        { invoiceNo: rx },
        { customerName: rx },
        { productName: rx },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10));
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 20));

    const all = await MaterialReturn.find(filter).sort({ createdAt: -1 }).lean();

    // Group by returnGroupId (fallback to mrId when no group)
    const groupsMap = new Map();
    for (const r of all) {
      const gid = r.returnGroupId || r.mrId;
      if (!groupsMap.has(gid)) {
        groupsMap.set(gid, {
          returnGroupId: gid,
          docketNumber: r.deliveryScheduleId || '',
          customer: r.customerName || '',
          invoiceNo: r.invoiceNo || '',
          returnDate: r.returnDate || r.createdAt,
          approvalStatus: r.approvalStatus,
          currentStage: r.currentStage,
          itemCount: 0,
          totalReturnQty: 0,
          totalValue: 0,
          items: [],
        });
      }
      const g = groupsMap.get(gid);
      g.itemCount += 1;
      g.totalReturnQty += Number(r.returnQty) || 0;
      g.totalValue += Number(r.value) || 0;
      g.items.push(r);
    }

    const groups = Array.from(groupsMap.values());
    const total = groups.length;
    const start = (pageNum - 1) * limitNum;
    const paged = groups.slice(start, start + limitNum);

    res.json({
      success: true,
      data: paged,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    console.error('[listMaterialReturns]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /delivery-agent/material-returns/dashboard ────────────────────────────
export const getDashboardStats = async (_req, res) => {
  try {
    const base = { sourceApp: 'delivery_app' };
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      total, draft, pending, underInspection, approved, rejected, closed,
      today, thisMonth,
    ] = await Promise.all([
      MaterialReturn.countDocuments(base),
      MaterialReturn.countDocuments({ ...base, currentStage: 'REQUEST_RAISED', approvalStatus: 'Pending' }),
      MaterialReturn.countDocuments({ ...base, approvalStatus: 'Pending' }),
      MaterialReturn.countDocuments({ ...base, qcStatus: 'In Progress' }),
      MaterialReturn.countDocuments({ ...base, approvalStatus: 'Approved' }),
      MaterialReturn.countDocuments({ ...base, approvalStatus: 'Rejected' }),
      MaterialReturn.countDocuments({ ...base, currentStage: 'CLOSED' }),
      MaterialReturn.countDocuments({ ...base, createdAt: { $gte: startOfDay } }),
      MaterialReturn.countDocuments({ ...base, createdAt: { $gte: startOfMonth } }),
    ]);

    res.json({
      success: true,
      data: {
        total, draft, pending, underInspection, approved, rejected, closed,
        today, thisMonth,
      },
    });
  } catch (err) {
    console.error('[getDashboardStats]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /delivery-agent/material-returns/group/:groupId ───────────────────────
// Full detail of a return group (all items + timeline).
export const getMaterialReturnGroup = async (req, res) => {
  try {
    const { groupId } = req.params;
    const items = await MaterialReturn.find({
      $or: [{ returnGroupId: groupId }, { mrId: groupId }],
    }).sort({ createdAt: 1 }).lean();

    if (!items.length) {
      return res.status(404).json({ success: false, message: 'Material return not found' });
    }

    const head = items[0];
    res.json({
      success: true,
      data: {
        returnGroupId: head.returnGroupId || head.mrId,
        docketNumber: head.deliveryScheduleId || '',
        docketId: head.docketId || '',
        customer: head.customerName || '',
        invoiceNo: head.invoiceNo || '',
        orderNo: head.orderNo || '',
        returnDate: head.returnDate || head.createdAt,
        createdBy: head.requestedBy || '',
        approvalStatus: head.approvalStatus,
        currentStage: head.currentStage,
        items,
      },
    });
  } catch (err) {
    console.error('[getMaterialReturnGroup]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /delivery-agent/material-returns/docket/:scheduleId/history ────────────
// Complete return history for an original docket (all returns against it).
export const getDocketReturnHistory = async (req, res) => {
  try {
    const { scheduleId } = req.params;

    const delivery = await DeliverySchedule.findOne({ scheduleId }).lean();
    if (!delivery) {
      return res.status(404).json({ success: false, message: 'Docket / delivery not found' });
    }

    const returns = await MaterialReturn.find({ deliveryScheduleId: scheduleId })
      .sort({ createdAt: -1 })
      .lean();

    const totalDeliveredQty = delivery.totalQty
      || (delivery.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);

    const totalReturnedQty = returns
      .filter((r) => r.approvalStatus !== 'Rejected')
      .reduce((s, r) => s + (Number(r.returnQty) || 0), 0);

    res.json({
      success: true,
      data: {
        docketNumber: delivery.scheduleId,
        customer: delivery.client,
        deliveryDate: delivery.deliveredAt || delivery.deliveryDate,
        totalDeliveredQty,
        totalReturnedQty,
        remainingQty: Math.max(0, totalDeliveredQty - totalReturnedQty),
        returns,
      },
    });
  } catch (err) {
    console.error('[getDocketReturnHistory]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
