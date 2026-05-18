import PurchaseOrder from '../models/PurchaseOrder.js';
import Inventory from '../models/Inventory.js';
import POInvoice from '../models/POInvoice.js';
import PendingOrder from '../models/PendingOrder.js';

// ── ID generator ──────────────────────────────────────────────────────────────
const genInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `POINV-${year}-`;
  const last = await POInvoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) })
    .sort({ createdAt: -1 });
  if (!last) return `${prefix}0001`;
  const parts = last.invoiceNo.split('-');
  const num = parseInt(parts[parts.length - 1]) || 0;
  return `${prefix}${String(num + 1).padStart(4, '0')}`;
};

// ── GET /api/po-generator/pos ─────────────────────────────────────────────────
// List all POs available for invoicing (Approved or Received)
export const listPOs = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status) {
      filter.status = status;
    } else {
      filter.status = { $in: ['Approved', 'Received', 'Pending', 'Draft'] };
    }
    if (search) {
      filter.$or = [
        { poId: { $regex: search, $options: 'i' } },
      ];
    }
    const pos = await PurchaseOrder.find(filter)
      .populate('vendor', 'companyName contactPerson phone email')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: pos });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/po-generator/stock-check/:poId ───────────────────────────────────
// For each item in the PO, find matching inventory by name (case-insensitive)
// Returns per-item: requestedQty, availableQty, status (Ready / Low Stock / Out of Stock)
export const stockCheck = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.poId)
      .populate('vendor', 'companyName contactPerson phone email');
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });

    // For each PO item, sum availableQuantity across all inventory records matching by name
    const itemResults = await Promise.all(
      (po.items || []).map(async (item) => {
        const inventoryRecords = await Inventory.find({
          name: { $regex: new RegExp(item.name.trim(), 'i') },
        });

        const totalAvailable = inventoryRecords.reduce(
          (sum, inv) => sum + (inv.availableQuantity || 0), 0
        );

        let stockStatus = 'Ready';
        if (totalAvailable === 0) stockStatus = 'Out of Stock';
        else if (totalAvailable < item.qty) stockStatus = 'Low Stock';

        const dispatchableQty = Math.min(totalAvailable, item.qty);
        const pendingQty = item.qty - dispatchableQty;

        return {
          itemName:       item.name,
          requestedQty:   item.qty,
          availableQty:   totalAvailable,
          dispatchableQty,
          pendingQty,
          unit:           item.unit,
          basePrice:      item.basePrice,
          gst:            item.gst,
          stockStatus,
          canFullFill:    totalAvailable >= item.qty,
        };
      })
    );

    const canFullInvoice = itemResults.every(i => i.canFullFill);
    const hasAnyStock    = itemResults.some(i => i.availableQty > 0);

    res.json({
      success: true,
      data: {
        po: {
          _id:         po._id,
          poId:        po.poId,
          status:      po.status,
          vendor:      po.vendor,
          grandTotal:  po.grandTotal,
          deliveryDate: po.deliveryDate,
          createdAt:   po.createdAt,
        },
        items:          itemResults,
        canFullInvoice,
        hasAnyStock,
        summary: {
          totalItems:     itemResults.length,
          readyItems:     itemResults.filter(i => i.stockStatus === 'Ready').length,
          lowStockItems:  itemResults.filter(i => i.stockStatus === 'Low Stock').length,
          outOfStockItems:itemResults.filter(i => i.stockStatus === 'Out of Stock').length,
        },
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/po-generator/generate-invoice ───────────────────────────────────
// Accept or reject partial invoice generation
// Body: { poId, action: 'accept'|'reject', items: [{ itemName, invoicedQty, pendingQty, ... }] }
export const generateInvoice = async (req, res) => {
  try {
    const { poId, action, items = [], notes = '' } = req.body;

    if (!poId) return res.status(400).json({ success: false, message: 'poId is required' });
    if (!['accept', 'reject'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be accept or reject' });

    const po = await PurchaseOrder.findById(poId).populate('vendor', 'companyName');
    if (!po) return res.status(404).json({ success: false, message: 'PO not found' });

    if (action === 'reject') {
      return res.json({
        success: true,
        message: 'Invoice generation rejected. PO remains pending.',
        data: { action: 'rejected', poId: po.poId },
      });
    }

    // action === 'accept' — generate partial invoice
    if (!items.length)
      return res.status(400).json({ success: false, message: 'No items provided for invoice' });

    const invoiceNo = await genInvoiceNo();

    // Build invoice items — only items with invoicedQty > 0
    const invoiceItems = items
      .filter(it => (it.invoicedQty || 0) > 0)
      .map(it => {
        const lineTotal = (it.invoicedQty || 0) * (it.basePrice || 0) * (1 + (it.gst || 18) / 100);
        return {
          itemName:     it.itemName,
          requestedQty: it.requestedQty,
          availableQty: it.availableQty,
          invoicedQty:  it.invoicedQty,
          pendingQty:   it.pendingQty,
          unit:         it.unit || 'Nos',
          basePrice:    it.basePrice || 0,
          gst:          it.gst || 18,
          lineTotal:    +lineTotal.toFixed(2),
        };
      });

    if (!invoiceItems.length)
      return res.status(400).json({ success: false, message: 'No items with invoiceable quantity' });

    const subtotal   = invoiceItems.reduce((s, it) => s + (it.invoicedQty * it.basePrice), 0);
    const gstTotal   = invoiceItems.reduce((s, it) => s + (it.invoicedQty * it.basePrice * it.gst / 100), 0);
    const grandTotal = subtotal + gstTotal;

    const isPartial = items.some(it => (it.pendingQty || 0) > 0);

    const invoice = await POInvoice.create({
      invoiceNo,
      poId:       po._id,
      poRef:      po.poId,
      vendorName: po.vendor?.companyName || '',
      items:      invoiceItems,
      subtotal:   +subtotal.toFixed(2),
      gstTotal:   +gstTotal.toFixed(2),
      grandTotal: +grandTotal.toFixed(2),
      invoiceType: isPartial ? 'partial' : 'full',
      status:     'Draft',
      notes,
    });

    // Save pending orders for items with remaining qty
    const pendingItems = items.filter(it => (it.pendingQty || 0) > 0);
    const pendingDocs = pendingItems.map(it => ({
      poId:         po._id,
      poRef:        po.poId,
      poInvoiceId:  invoice._id,
      vendorName:   po.vendor?.companyName || '',
      itemName:     it.itemName,
      requestedQty: it.requestedQty,
      invoicedQty:  it.invoicedQty,
      pendingQty:   it.pendingQty,
      unit:         it.unit || 'Nos',
      basePrice:    it.basePrice || 0,
      status:       'Pending',
      notes,
    }));

    if (pendingDocs.length) {
      await PendingOrder.insertMany(pendingDocs);
    }

    res.status(201).json({
      success: true,
      message: `Invoice ${invoiceNo} generated successfully${isPartial ? ' (Partial)' : ''}`,
      data: {
        invoice,
        pendingCount: pendingDocs.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/po-generator/generate-invoice-from-pdf ─────────────────────────
// Creates invoice directly from PDF-parsed data (no PO in DB required)
export const generateInvoiceFromPDF = async (req, res) => {
  try {
    const { poNumber, vendorName, buyerName, items = [], total, notes = '' } = req.body;

    if (!items.length)
      return res.status(400).json({ success: false, message: 'No items provided' });

    const invoiceNo = await genInvoiceNo();

    const invoiceItems = items.map(it => {
      const qty       = it.qty || 1;
      const rate      = it.rate || it.basePrice || 0;
      const gst       = it.gst || 18;
      const disc      = it.discount || 0;
      const cgst      = it.cgst || 0;
      const sgst      = it.sgst || 0;
      const igst      = it.igst || 0;
      const taxable   = it.taxableValue || +(qty * rate * (1 - disc / 100)).toFixed(2);
      const lineTotal = it.lineAmount
        ? +parseFloat(it.lineAmount).toFixed(2)
        : +(taxable * (1 + gst / 100)).toFixed(2);

      return {
        itemName:     it.name || it.itemName || 'Item',
        requestedQty: qty,
        availableQty: qty,
        invoicedQty:  qty,
        pendingQty:   0,
        unit:         it.unit || 'Nos',
        basePrice:    rate,
        gst,
        cgst,
        sgst,
        igst,
        discount:     disc,
        taxableValue: taxable,
        lineTotal,
        hsn:          it.hsn || '',
      };
    });

    // Use grand total from PDF if provided — most accurate
    let grandTotal, subtotal, gstTotal;
    if (total && parseFloat(total) > 0) {
      grandTotal = +parseFloat(total).toFixed(2);
      subtotal   = +(invoiceItems.reduce((s, it) => s + it.invoicedQty * it.basePrice, 0)).toFixed(2);
      gstTotal   = +(grandTotal - subtotal).toFixed(2);
    } else {
      subtotal   = +(invoiceItems.reduce((s, it) => s + it.invoicedQty * it.basePrice, 0)).toFixed(2);
      gstTotal   = +(invoiceItems.reduce((s, it) => s + it.invoicedQty * it.basePrice * it.gst / 100, 0)).toFixed(2);
      grandTotal = +(subtotal + gstTotal).toFixed(2);
    }

    const invoice = await POInvoice.create({
      invoiceNo,
      poId:       null,
      poRef:      poNumber || 'PDF-UPLOAD',
      vendorName: vendorName || '',
      buyerName:  buyerName || '',
      items:      invoiceItems,
      subtotal,
      gstTotal,
      grandTotal,
      invoiceType: 'full',
      status:     'Draft',
      notes,
    });

    res.status(201).json({
      success: true,
      message: `Invoice ${invoiceNo} created — ₹${grandTotal.toLocaleString('en-IN')}`,
      data: { invoice },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
export const listInvoices = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { invoiceNo:  { $regex: search, $options: 'i' } },
        { poRef:      { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } },
      ];
    }
    const invoices = await POInvoice.find(filter)
      .populate('poId', 'poId status vendor')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: invoices });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/po-generator/invoices/:id ───────────────────────────────────────
export const getInvoiceById = async (req, res) => {
  try {
    const invoice = await POInvoice.findById(req.params.id)
      .populate('poId', 'poId status vendor deliveryDate paymentTerms');
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/po-generator/invoices/:id/status ───────────────────────────────
export const updateInvoiceStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const invoice = await POInvoice.findByIdAndUpdate(
      req.params.id, { status }, { new: true }
    );
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/po-generator/pending-orders ─────────────────────────────────────
export const listPendingOrders = async (req, res) => {
  try {
    const { status, search } = req.query;
    const filter = {};
    if (status) filter.status = status;
    else filter.status = 'Pending';
    if (search) {
      filter.$or = [
        { poRef:      { $regex: search, $options: 'i' } },
        { itemName:   { $regex: search, $options: 'i' } },
        { vendorName: { $regex: search, $options: 'i' } },
      ];
    }
    const orders = await PendingOrder.find(filter)
      .populate('poId', 'poId status')
      .populate('poInvoiceId', 'invoiceNo')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: orders });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/po-generator/pending-orders/:id ───────────────────────────────
export const updatePendingOrder = async (req, res) => {
  try {
    const order = await PendingOrder.findByIdAndUpdate(
      req.params.id, req.body, { new: true }
    );
    if (!order) return res.status(404).json({ success: false, message: 'Pending order not found' });
    res.json({ success: true, data: order });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /api/po-generator/invoices/:id/delivery ────────────────────────────
// Update delivery status for each item in the invoice
// Body: { items: [{ itemId, deliveryStatus, deliveredQty, deliveryDate, deliveryNotes }] }
export const updateDelivery = async (req, res) => {
  try {
    const { items = [] } = req.body;
    const invoice = await POInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });

    // Update each item's delivery status
    for (const update of items) {
      const item = invoice.items.id(update.itemId);
      if (item) {
        item.deliveryStatus  = update.deliveryStatus  || item.deliveryStatus;
        item.deliveredQty    = update.deliveredQty    ?? item.deliveredQty;
        item.deliveryDate    = update.deliveryDate    ? new Date(update.deliveryDate) : item.deliveryDate;
        item.deliveryNotes   = update.deliveryNotes   ?? item.deliveryNotes;
      }
    }

    // Auto-compute invoice-level delivery status
    const allItems = invoice.items;
    const allDelivered     = allItems.every(it => it.deliveryStatus === 'Delivered');
    const noneDelivered    = allItems.every(it => it.deliveryStatus === 'Pending' || it.deliveryStatus === 'Not Delivered');
    const someNotDelivered = allItems.some(it => it.deliveryStatus === 'Not Delivered');

    if (allDelivered) {
      invoice.deliveryStatus      = 'Fully Delivered';
      invoice.deliveryCompletedAt = new Date();
    } else if (noneDelivered && someNotDelivered) {
      invoice.deliveryStatus = 'Pending';
    } else {
      invoice.deliveryStatus = 'Partially Delivered';
    }

    await invoice.save();
    res.json({ success: true, data: invoice, message: 'Delivery status updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/po-generator/invoices/:id ─────────────────────────────────────
export const deleteInvoice = async (req, res) => {
  try {
    const invoice = await POInvoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'Invoice not found' });
    // Also delete related pending orders
    await PendingOrder.deleteMany({ poInvoiceId: req.params.id });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/po-generator/pos/:id ─────────────────────────────────────────
export const deletePO = async (req, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndDelete(req.params.id);
    if (!po) return res.status(404).json({ success: false, message: 'Purchase Order not found' });
    res.json({ success: true, message: 'Purchase Order deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
export const getStats = async (req, res) => {
  try {
    const [
      totalInvoices, draftInvoices, approvedInvoices, paidInvoices,
      totalPending, fulfilledPending,
      partialInvoices, fullInvoices,
      totalPOs,
    ] = await Promise.all([
      POInvoice.countDocuments(),
      POInvoice.countDocuments({ status: 'Draft' }),
      POInvoice.countDocuments({ status: 'Approved' }),
      POInvoice.countDocuments({ status: 'Paid' }),
      PendingOrder.countDocuments({ status: 'Pending' }),
      PendingOrder.countDocuments({ status: 'Fulfilled' }),
      POInvoice.countDocuments({ invoiceType: 'partial' }),
      POInvoice.countDocuments({ invoiceType: 'full' }),
      PurchaseOrder.countDocuments(),
    ]);

    const valueAgg = await POInvoice.aggregate([
      { $group: { _id: null, total: { $sum: '$grandTotal' } } },
    ]);

    // ── Last 7 days daily trend ──────────────────────────────────────────────
    const days = 7;
    const now  = new Date();
    const from = new Date(now); from.setDate(from.getDate() - (days - 1)); from.setHours(0,0,0,0);

    const [invoiceTrend, poTrend] = await Promise.all([
      POInvoice.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count:   { $sum: 1 },
          partial: { $sum: { $cond: [{ $eq: ['$invoiceType', 'partial'] }, 1, 0] } },
          full:    { $sum: { $cond: [{ $eq: ['$invoiceType', 'full'] }, 1, 0] } },
          value:   { $sum: '$grandTotal' },
        }},
        { $sort: { _id: 1 } },
      ]),
      PurchaseOrder.aggregate([
        { $match: { createdAt: { $gte: from } } },
        { $group: {
          _id:   { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
    ]);

    // Fill all 7 days (even if 0)
    const trend = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(from); d.setDate(d.getDate() + i);
      const key = d.toISOString().split('T')[0];
      const inv = invoiceTrend.find(x => x._id === key) || {};
      const po  = poTrend.find(x => x._id === key)      || {};
      trend.push({
        date:     key,
        label:    d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
        invoices: inv.count   || 0,
        partial:  inv.partial || 0,
        full:     inv.full    || 0,
        value:    inv.value   || 0,
        pos:      po.count    || 0,
      });
    }

    res.json({
      success: true,
      data: {
        totalInvoices, draftInvoices, approvedInvoices, paidInvoices,
        totalPending, fulfilledPending,
        partialInvoices, fullInvoices,
        totalValue: valueAgg[0]?.total || 0,
        totalPOs,
        trend,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
