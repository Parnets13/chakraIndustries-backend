import Invoice from '../models/Invoice.js';
import { sendInvoiceEmail } from '../utils/emailService.js';

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
    const { status, search, page = 1, limit = 50 } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (search) filter.$or = [
      { invoiceNo:  { $regex: search, $options: 'i' } },
      { partyName:  { $regex: search, $options: 'i' } },
    ];
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [list, total] = await Promise.all([
      Invoice.find(filter).sort({ serialNo: 1, createdAt: 1 }).skip(skip).limit(parseInt(limit)),
      Invoice.countDocuments(filter),
    ]);
    res.json({ success: true, data: list, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/invoices/stats ───────────────────────────────────────────────────
export const getStats = async (req, res) => {
  try {
    const [total, draft, sent, paid, overdue, cancelled, totalValueAgg, paidValueAgg, pendingValueAgg] =
      await Promise.all([
        Invoice.countDocuments(),
        Invoice.countDocuments({ status: 'Draft' }),
        Invoice.countDocuments({ status: 'Sent' }),
        Invoice.countDocuments({ status: 'Paid' }),
        Invoice.countDocuments({ status: 'Overdue' }),
        Invoice.countDocuments({ status: 'Cancelled' }),
        Invoice.aggregate([{ $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
        Invoice.aggregate([{ $match: { status: 'Paid' } }, { $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
        Invoice.aggregate([{ $match: { status: { $in: ['Draft','Sent','Overdue'] } } }, { $group: { _id: null, v: { $sum: '$grandTotal' } } }]),
      ]);
    res.json({
      success: true,
      data: {
        total, draft, sent, paid, overdue, cancelled,
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
    const inv = await Invoice.create({ invoiceNo, ...rest, ...totals, source: 'manual' });
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
    const inv = await Invoice.findByIdAndUpdate(
      req.params.id,
      { ...rest, ...totals },
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
