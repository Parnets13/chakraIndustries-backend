import Invoice from '../models/Invoice.js';
import SalesOrder from '../models/SalesOrder.js';
import Dealer from '../models/Dealer.js';
import AccountsReceivable from '../models/AccountsReceivable.js';
import { sendInvoiceEmail } from '../utils/emailService.js';
import { pushSingleInvoiceToTally } from '../services/tallyService.js';

// ── ID generator ──────────────────────────────────────────────────────────────
const genInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await Invoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) })
    .sort({ createdAt: -1 });
  if (!last) return `${prefix}0001`;
  const parts = last.invoiceNo.split('-');
  const num = parseInt(parts[parts.length - 1]) || 0;
  return `${prefix}${String(num + 1).padStart(4, '0')}`;
};

// ── Compute totals from items ─────────────────────────────────────────────────
const computeTotals = (items = []) => {
  let subtotal = 0, totalDiscount = 0, totalTax = 0;
  const computed = items.map(item => {
    const base     = (item.qty || 0) * (item.rate || 0);
    const discAmt  = base * ((item.discount || 0) / 100);
    const amount   = base - discAmt;

    // Use stored tax amounts if provided (from Excel), otherwise compute from taxRate
    const storedCGST = item.cgst || 0;
    const storedSGST = item.sgst || 0;
    const storedIGST = item.igst || 0;
    const storedTax  = storedCGST + storedSGST + storedIGST;

    const taxAmt   = storedTax > 0 ? storedTax : amount * ((item.taxRate || 0) / 100);
    const total    = amount + taxAmt;

    subtotal      += base;
    totalDiscount += discAmt;
    totalTax      += taxAmt;

    return {
      ...item,
      basic:     +amount.toFixed(2),   // taxable amount (qty × rate − discount)
      amount:    +amount.toFixed(2),
      taxAmount: +taxAmt.toFixed(2),
      total:     +total.toFixed(2),
      cgst:      storedCGST,
      sgst:      storedSGST,
      igst:      storedIGST,
    };
  });
  const grandTotal = subtotal - totalDiscount + totalTax;
  return {
    items: computed,
    subtotal:      +subtotal.toFixed(2),
    totalDiscount: +totalDiscount.toFixed(2),
    totalTax:      +totalTax.toFixed(2),
    grandTotal:    +grandTotal.toFixed(2),
  };
};

// ── GET /api/invoices ─────────────────────────────────────────────────────────
export const getAll = async (req, res) => {
  try {
    const { status, search, page = 1, limit = 0, invoiceType, invoiceSource } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (invoiceType) filter.invoiceType = invoiceType;
    if (invoiceSource) filter.invoiceSource = invoiceSource;
    if (search) filter.$or = [
      { invoiceNo:  { $regex: search, $options: 'i' } },
      { partyName:  { $regex: search, $options: 'i' } },
      { purchaseOrderRef: { $regex: search, $options: 'i' } },
    ];

    const limitNum = parseInt(limit);
    const query = Invoice.find(filter).sort({ serialNo: 1, createdAt: 1 });

    // limit=0 means fetch all (no pagination)
    if (limitNum > 0) {
      const skip = (parseInt(page) - 1) * limitNum;
      query.skip(skip).limit(limitNum);
    }

    const [list, total] = await Promise.all([
      query,
      Invoice.countDocuments(filter),
    ]);
    res.json({ success: true, data: list, total, page: parseInt(page), limit: limitNum });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/invoices/stats ───────────────────────────────────────────────────
export const getStats = async (req, res) => {
  try {
    const [total, draft, sent, paid, overdue, cancelled, singleCount, multiCount, totalValueAgg, paidValueAgg, pendingValueAgg] =
      await Promise.all([
        Invoice.countDocuments(),
        Invoice.countDocuments({ status: 'Draft' }),
        Invoice.countDocuments({ status: 'Sent' }),
        Invoice.countDocuments({ status: 'Paid' }),
        Invoice.countDocuments({ status: 'Overdue' }),
        Invoice.countDocuments({ status: 'Cancelled' }),
        Invoice.countDocuments({ invoiceType: 'single' }),
        Invoice.countDocuments({ invoiceType: 'multi' }),
        Invoice.aggregate([{ $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
        Invoice.aggregate([{ $match: { status: 'Paid' } }, { $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
        Invoice.aggregate([{ $match: { status: { $in: ['Draft','Sent','Overdue'] } } }, { $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
      ]);
    res.json({
      success: true,
      data: {
        total, draft, sent, paid, overdue, cancelled,
        singleCount, multiCount,
        totalValue:   totalValueAgg[0]?.v   || 0,
        paidValue:    paidValueAgg[0]?.v    || 0,
        pendingValue: pendingValueAgg[0]?.v || 0,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────
export const getById = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices ────────────────────────────────────────────────────────
export const create = async (req, res) => {
  try {
    const invoiceNo = await genInvoiceNo();
    const { items = [], ...rest } = req.body;
    const totals = computeTotals(items);
    const invoiceType = items.length > 1 ? 'multi' : 'single';
    const inv = await Invoice.create({ invoiceNo, ...rest, ...totals, source: 'manual', invoiceType });
    await AccountsReceivable.create({
      dealer: inv.dealerId,
      salesOrder: inv.salesOrderId,
      invoice: inv._id,
      invoiceNumber: inv.invoiceNo,
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      invoiceAmount: inv.grandTotal
    });
    res.status(201).json({ success: true, data: inv });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/bulk-upload ────────────────────────────────────────────
// Accepts array of invoice objects parsed from Excel on the frontend.
// Uses insertMany (single DB round-trip) instead of a sequential loop —
// handles 1000+ rows without hitting body-size or timeout limits.
export const bulkUpload = async (req, res) => {
  try {
    const { invoices = [] } = req.body;
    if (!invoices.length)
      return res.status(400).json({ success: false, message: 'No invoices provided' });

    const batchId = `BATCH-${Date.now()}`;
    const year    = new Date().getFullYear();
    const prefix  = `INV-${year}-`;

    // One query to find the current highest number
    const last = await Invoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) })
      .sort({ createdAt: -1 })
      .select('invoiceNo');
    const lastNum = last ? (parseInt(last.invoiceNo.split('-').pop()) || 0) : 0;

    // Build all docs in memory — no per-row DB calls
    const docs   = [];
    const errors = [];

    invoices.forEach((inv, i) => {
      try {
        const invoiceNo = `${prefix}${String(lastNum + i + 1).padStart(4, '0')}`;
        const { items = [], ...rest } = inv;
        const totals = computeTotals(items);
        docs.push({
          invoiceNo,
          ...rest,
          ...totals,
          source:      'excel_upload',
          uploadBatch: batchId,
          serialNo:    i + 1,
          status:      rest.status || 'Draft',
          invoiceType: items.length > 1 ? 'multi' : 'single',
        });
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    });

    if (!docs.length) {
      return res.status(400).json({ success: false, message: 'All rows failed validation', errors });
    }

    // Single insertMany — ordered:false means valid docs still insert even if some fail
    let inserted = [];
    try {
      inserted = await Invoice.insertMany(docs, { ordered: false });
    } catch (bulkErr) {
      // BulkWriteError: partial success — some docs inserted, some failed
      if (bulkErr.insertedDocs) inserted = bulkErr.insertedDocs;
      else if (bulkErr.result?.insertedIds) {
        // Mongoose may not populate insertedDocs; fetch them by batchId
        inserted = await Invoice.find({ uploadBatch: batchId });
      }
      errors.push({ row: 'multiple', error: bulkErr.message });
    }

    res.status(201).json({
      success: true,
      data: { created: inserted.length, errors, batchId, invoices: inserted },
    });
  } catch (err) {
    console.error('[bulkUpload]', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/invoices/:id ─────────────────────────────────────────────────────
export const update = async (req, res) => {
  try {
    const { items = [], ...rest } = req.body;
    const totals = computeTotals(items);
    const invoiceType = items.length > 1 ? 'multi' : 'single';
    const inv = await Invoice.findByIdAndUpdate(
      req.params.id,
      { ...rest, ...totals, invoiceType },
      { new: true, runValidators: true }
    );
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── PATCH /api/invoices/:id/status ────────────────────────────────────────────
export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const inv = await Invoice.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/migrate-types ─────────────────────────────────────────
// One-time migration: set invoiceType on all existing docs based on items.length
export const migrateTypes = async (req, res) => {
  try {
    const all = await Invoice.find({}, { _id: 1, items: 1 });
    const ops = all.map(inv => ({
      updateOne: {
        filter: { _id: inv._id },
        update: { $set: { invoiceType: (inv.items?.length || 0) > 1 ? 'multi' : 'single' } },
      },
    }));
    const result = await Invoice.bulkWrite(ops, { ordered: false });
    res.json({ success: true, updated: result.modifiedCount, total: all.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DELETE /api/invoices (delete all) ────────────────────────────────────────
export const removeAll = async (req, res) => {
  try {
    const result = await Invoice.deleteMany({});
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────────
export const remove = async (req, res) => {
  try {
    const inv = await Invoice.findByIdAndDelete(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/:id/send-email ─────────────────────────────────────────
// Frontend sends pdfBase64 (jsPDF output); backend attaches it and emails via Nodemailer.
export const sendEmail = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    const { pdfBase64 } = req.body;
    if (!pdfBase64)
      return res.status(400).json({ success: false, message: 'pdfBase64 is required' });

    const to = inv.partyEmail;
    if (!to)
      return res.status(400).json({ success: false, message: 'Invoice has no recipient email address' });

    await sendInvoiceEmail({
      to,
      partyName:   inv.partyName,
      invoice:     inv.toObject(),
      pdfBase64,
      pdfFilename: `${inv.invoiceNo}.pdf`,
    });

    // Auto-advance status from Draft → Sent
    if (inv.status === 'Draft') {
      await Invoice.findByIdAndUpdate(req.params.id, { status: 'Sent' });
    }

    res.json({ success: true, message: `Invoice emailed to ${to}` });
  } catch (err) {
    console.error('[sendEmail]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/invoices/no/:invoiceNo ─────────────────────────────────────────
export const getByInvoiceNo = async (req, res) => {
  try {
    const inv = await Invoice.findOne({ invoiceNo: req.params.invoiceNo });
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, data: inv });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/invoices/from-order/:orderId ────────────────────────────────────
export const createFromSalesOrder = async (req, res) => {
  try {
    const order = await SalesOrder.findById(req.params.orderId);
    if (!order) return res.status(404).json({ success: false, message: 'Sales order not found' });
    
    // Check if invoice already exists for this order
    const existingInvoice = await Invoice.findOne({ salesOrderId: order._id });
    if (existingInvoice) return res.status(400).json({ success: false, message: 'Invoice already exists for this order' });
    
    // Get dealer details if available
    let dealer = null;
    if (order.dealerId) {
      dealer = await Dealer.findById(order.dealerId);
    }
    
    const invoiceNo = await genInvoiceNo();
    
    // Build invoice items from order lineItems or items
    const items = [];
    if (order.lineItems && order.lineItems.length > 0) {
      order.lineItems.forEach(item => {
        const taxRate = item.gstPercent || 0;
        items.push({
          description: item.name || 'Item',
          hsn: '',
          qty: item.quantity || 0,
          unit: 'Nos',
          rate: item.unitPrice || 0,
          discount: 0,
          taxRate,
          cgst: (item.gstAmount || 0) / 2,
          sgst: (item.gstAmount || 0) / 2,
          igst: 0
        });
      });
    } else if (order.items && order.items.length > 0) {
      order.items.forEach(item => {
        const taxRate = item.gstPercent || 0;
        items.push({
          description: item.itemName || 'Item',
          hsn: '',
          qty: item.quantity || 0,
          unit: 'Nos',
          rate: item.unitPrice || 0,
          discount: 0,
          taxRate,
          cgst: (item.gstAmount || 0) / 2,
          sgst: (item.gstAmount || 0) / 2,
          igst: 0
        });
      });
    }
    
    const totals = computeTotals(items);
    
    // Create invoice
    const invoice = await Invoice.create({
      invoiceNo,
      invoiceDate: new Date(),
      dealerId: order.dealerId || null,
      salesOrderId: order._id,
      partyName: dealer?.businessName || dealer?.name || order.customer || 'Customer',
      partyAddress: dealer?.address || '',
      partyGST: dealer?.gstin || '',
      partyEmail: dealer?.email || '',
      partyPhone: dealer?.mobile || '',
      billToName: dealer?.businessName || dealer?.name || order.customer || 'Customer',
      billToAddress: dealer?.address || '',
      billToGST: dealer?.gstin || '',
      shipToName: dealer?.businessName || dealer?.name || order.customer || 'Customer',
      shipToAddress: order.deliveryAddress || '',
      purchaseOrderRef: order.orderId,
      items: totals.items,
      subtotal: totals.subtotal,
      totalDiscount: totals.totalDiscount,
      totalTax: totals.totalTax,
      grandTotal: totals.grandTotal,
      status: 'Draft',
      paymentStatus: 'Pending',
      source: 'manual',
      invoiceType: items.length > 1 ? 'multi' : 'single'
    });
    
    await AccountsReceivable.create({
      dealer: invoice.dealerId,
      salesOrder: invoice.salesOrderId,
      invoice: invoice._id,
      invoiceNumber: invoice.invoiceNo,
      invoiceDate: invoice.invoiceDate,
      dueDate: invoice.dueDate,
      invoiceAmount: invoice.grandTotal
    });
    
    res.status(201).json({ success: true, data: invoice });
  } catch (err) {
    console.error('createFromSalesOrder error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/invoices/:id/send-to-tally ──────────────────────────────────────
// One-click push of a single ERP invoice into Tally as a Sales Voucher.
// After a successful push the invoice's tallySync flag is set to true.
export const sendToTally = async (req, res) => {
  try {
    const inv = await Invoice.findById(req.params.id).lean();
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });

    if (inv.source === 'Tally' || inv.source === 'tally') {
      return res.status(400).json({ success: false, message: 'This invoice was imported from Tally — no need to push back.' });
    }

    const result = await pushSingleInvoiceToTally(req.params.id);

    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.error || 'Failed to push invoice to Tally' });
    }

    // Fetch updated invoice to return fresh tallySync status
    const updated = await Invoice.findById(req.params.id).lean();
    res.json({
      success: true,
      message: `Invoice ${result.invoiceNo} pushed to Tally successfully`,
      data: updated,
      warning: result.warning || null,
      duration: result.duration,
    });
  } catch (err) {
    console.error('[sendToTally]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
