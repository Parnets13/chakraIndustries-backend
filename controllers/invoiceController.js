import Invoice from '../models/Invoice.js';

// ── ID generator ──────────────────────────────────────────────────────────────
const genInvoiceNo = async () => {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const last = await Invoice.findOne({ invoiceNo: new RegExp(`^${prefix}`) }).sort({ invoiceNo: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.invoiceNo.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

// ── Compute totals from items ─────────────────────────────────────────────────
const computeTotals = (items = []) => {
  let subtotal = 0, totalDiscount = 0, totalTax = 0;
  const computed = items.map(item => {
    const base     = (item.qty || 0) * (item.rate || 0);
    const discAmt  = base * ((item.discount || 0) / 100);
    const amount   = base - discAmt;
    const taxAmt   = amount * ((item.taxRate || 0) / 100);
    const total    = amount + taxAmt;
    subtotal      += base;
    totalDiscount += discAmt;
    totalTax      += taxAmt;
    return { ...item, amount: +amount.toFixed(2), taxAmount: +taxAmt.toFixed(2), total: +total.toFixed(2) };
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
      Invoice.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Invoice.countDocuments(filter),
    ]);
    res.json({ success: true, data: list, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/invoices/stats ───────────────────────────────────────────────────
export const getStats = async (req, res) => {
  try {
    const all = await Invoice.find();
    const stats = {
      total:       all.length,
      draft:       all.filter(i => i.status === 'Draft').length,
      sent:        all.filter(i => i.status === 'Sent').length,
      paid:        all.filter(i => i.status === 'Paid').length,
      overdue:     all.filter(i => i.status === 'Overdue').length,
      cancelled:   all.filter(i => i.status === 'Cancelled').length,
      totalValue:  all.reduce((s, i) => s + (i.grandTotal || 0), 0),
      paidValue:   all.filter(i => i.status === 'Paid').reduce((s, i) => s + (i.grandTotal || 0), 0),
      pendingValue:all.filter(i => ['Draft','Sent','Overdue'].includes(i.status)).reduce((s, i) => s + (i.grandTotal || 0), 0),
    };
    res.json({ success: true, data: stats });
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
// Accepts array of invoice objects parsed from Excel on the frontend
export const bulkUpload = async (req, res) => {
  try {
    const { invoices = [] } = req.body;
    if (!invoices.length) return res.status(400).json({ success: false, message: 'No invoices provided' });

    const batchId = `BATCH-${Date.now()}`;
    const created = [];
    const errors  = [];

    for (let i = 0; i < invoices.length; i++) {
      try {
        const invoiceNo = await genInvoiceNo();
        const { items = [], ...rest } = invoices[i];
        const totals = computeTotals(items);
        const inv = await Invoice.create({
          invoiceNo,
          ...rest,
          ...totals,
          source: 'excel_upload',
          uploadBatch: batchId,
        });
        created.push(inv);
      } catch (e) {
        errors.push({ row: i + 1, error: e.message });
      }
    }

    res.status(201).json({
      success: true,
      data: { created: created.length, errors, batchId, invoices: created },
    });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
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

// ── DELETE /api/invoices/:id ──────────────────────────────────────────────────
export const remove = async (req, res) => {
  try {
    const inv = await Invoice.findByIdAndDelete(req.params.id);
    if (!inv) return res.status(404).json({ success: false, message: 'Invoice not found' });
    res.json({ success: true, message: 'Invoice deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
