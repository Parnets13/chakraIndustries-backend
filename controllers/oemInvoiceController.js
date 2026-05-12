import OEMInvoice from '../models/OEMInvoice.js';
import OEMOrder from '../models/OEMOrder.js';
import OEMBrand from '../models/OEMBrand.js';

// ── ID generator ──────────────────────────────────────────────────────────────
async function genInvoiceNumber() {
  const last = await OEMInvoice.findOne().sort({ createdAt: -1 }).select('invoiceNumber');
  let n = 1;
  if (last?.invoiceNumber) { const m = last.invoiceNumber.match(/(\d+)$/); if (m) n = parseInt(m[1]) + 1; }
  let id = `OEMINV-${String(n).padStart(5, '0')}`;
  while (await OEMInvoice.findOne({ invoiceNumber: id })) { n++; id = `OEMINV-${String(n).padStart(5, '0')}`; }
  return id;
}

// ══════════════════════════════════════════════════════════════════════════════
// OEM INVOICE CRUD
// ══════════════════════════════════════════════════════════════════════════════

export const getAllOEMInvoices = async (req, res) => {
  try {
    const { paymentStatus, brandId, skip = 0, limit = 50 } = req.query;
    const query = {};
    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (brandId) query.oemBrand = brandId;

    const invoices = await OEMInvoice.find(query)
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('corporateClientId', 'clientName email')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await OEMInvoice.countDocuments(query);
    res.json({ success: true, data: invoices, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getOEMInvoicesByBrand = async (req, res) => {
  try {
    const { brandId } = req.params;
    const { paymentStatus, skip = 0, limit = 50 } = req.query;
    const query = { oemBrand: brandId };
    if (paymentStatus) query.paymentStatus = paymentStatus;

    const invoices = await OEMInvoice.find(query)
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('corporateClientId', 'clientName email')
      .sort({ createdAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit));

    const total = await OEMInvoice.countDocuments(query);
    res.json({ success: true, data: invoices, total });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getOEMInvoiceById = async (req, res) => {
  try {
    const invoice = await OEMInvoice.findById(req.params.id)
      .populate('oemOrderId', 'oemOrderId product quantity bomId')
      .populate('corporateClientId', 'clientName email contactPerson');
    if (!invoice) return res.status(404).json({ success: false, message: 'OEM invoice not found' });
    res.json({ success: true, data: invoice });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createOEMInvoice = async (req, res) => {
  try {
    const { oemOrderId, corporateClientId, quantity, unitPrice, taxRate = 18 } = req.body;
    if (!oemOrderId) return res.status(400).json({ success: false, message: 'OEM order is required' });
    if (!corporateClientId) return res.status(400).json({ success: false, message: 'Corporate client is required' });
    if (!quantity || quantity < 1) return res.status(400).json({ success: false, message: 'Quantity must be at least 1' });
    if (!unitPrice || unitPrice < 0) return res.status(400).json({ success: false, message: 'Unit price is required' });

    const order = await OEMOrder.findById(oemOrderId);
    if (!order) return res.status(400).json({ success: false, message: 'OEM order not found' });

    const invoiceNumber = await genInvoiceNumber();
    const subtotal = quantity * unitPrice;
    const taxAmount = (subtotal * taxRate) / 100;
    const totalAmount = subtotal + taxAmount;

    const invoice = await OEMInvoice.create({
      invoiceNumber,
      oemOrderId,
      corporateClientId,
      quantity,
      unitPrice,
      subtotal,
      taxRate,
      taxAmount,
      totalAmount,
      ...req.body,
    });

    const populated = await invoice.populate([
      { path: 'oemOrderId', select: 'oemOrderId product quantity' },
      { path: 'corporateClientId', select: 'clientName email' },
    ]);

    res.status(201).json({ success: true, message: 'OEM invoice created', data: populated });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateOEMInvoice = async (req, res) => {
  try {
    const invoice = await OEMInvoice.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('corporateClientId', 'clientName email');
    if (!invoice) return res.status(404).json({ success: false, message: 'OEM invoice not found' });
    res.json({ success: true, message: 'OEM invoice updated', data: invoice });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateOEMInvoicePaymentStatus = async (req, res) => {
  try {
    const { paymentStatus } = req.body;
    if (!paymentStatus) return res.status(400).json({ success: false, message: 'Payment status is required' });

    const invoice = await OEMInvoice.findByIdAndUpdate(req.params.id, { paymentStatus }, { new: true })
      .populate('oemOrderId', 'oemOrderId product quantity')
      .populate('corporateClientId', 'clientName email');
    if (!invoice) return res.status(404).json({ success: false, message: 'OEM invoice not found' });
    res.json({ success: true, message: 'Payment status updated', data: invoice });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const recordOEMInvoicePayment = async (req, res) => {
  try {
    const { amount, method, reference, remarks } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ success: false, message: 'Amount must be greater than 0' });

    const invoice = await OEMInvoice.findById(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'OEM invoice not found' });

    const newAmountPaid = (invoice.amountPaid || 0) + amount;
    const newPaymentStatus = newAmountPaid >= invoice.totalAmount ? 'Paid' : 'Partial';

    invoice.amountPaid = newAmountPaid;
    invoice.paymentStatus = newPaymentStatus;
    invoice.paymentDate = new Date();
    invoice.paymentHistory.push({
      amount,
      date: new Date(),
      method,
      reference,
      remarks,
    });

    await invoice.save();
    const populated = await invoice.populate([
      { path: 'oemOrderId', select: 'oemOrderId product quantity' },
      { path: 'corporateClientId', select: 'clientName email' },
    ]);

    res.json({ success: true, message: 'Payment recorded', data: populated });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteOEMInvoice = async (req, res) => {
  try {
    const invoice = await OEMInvoice.findByIdAndDelete(req.params.id);
    if (!invoice) return res.status(404).json({ success: false, message: 'OEM invoice not found' });
    res.json({ success: true, message: 'OEM invoice deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ══════════════════════════════════════════════════════════════════════════════
// OEM INVOICE STATS
// ══════════════════════════════════════════════════════════════════════════════
export const getOEMInvoiceStats = async (req, res) => {
  try {
    const { brandId } = req.query;
    const query = brandId ? { oemBrand: brandId } : {};

    const total = await OEMInvoice.countDocuments(query);
    const byStatus = await OEMInvoice.aggregate([
      { $match: query },
      { $group: { _id: '$paymentStatus', count: { $sum: 1 } } },
    ]);

    const totalAmount = await OEMInvoice.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);

    const totalPaid = await OEMInvoice.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$amountPaid' } } },
    ]);

    res.json({
      success: true,
      data: {
        totalInvoices: total,
        byStatus: byStatus.reduce((acc, s) => ({ ...acc, [s._id]: s.count }), {}),
        totalAmount: totalAmount[0]?.total || 0,
        totalPaid: totalPaid[0]?.total || 0,
        totalPending: (totalAmount[0]?.total || 0) - (totalPaid[0]?.total || 0),
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
