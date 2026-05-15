import BulkOrder from '../models/BulkOrder.js';
import BulkQuotation from '../models/BulkQuotation.js';
import CorporateClient from '../models/CorporateClient.js';
import DeliverySchedule from '../models/DeliverySchedule.js';

const generateOrderId = async () => {
  const last = await BulkOrder.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'BO-2024-001';
  const num = parseInt(last.orderId?.split('-')[2] || '0') + 1;
  return `BO-2024-${String(num).padStart(3, '0')}`;
};

// ── CORPORATE CLIENTS ─────────────────────────────────────────────────────────
export const getClients = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const list = await CorporateClient.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createClient = async (req, res) => {
  try {
    const clientId = `CC-${Date.now()}`;
    const client = await CorporateClient.create({ ...req.body, clientId });
    res.status(201).json({ success: true, data: client });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateClient = async (req, res) => {
  try {
    const client = await CorporateClient.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!client) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: client });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteClient = async (req, res) => {
  try {
    await CorporateClient.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── BULK QUOTATIONS ───────────────────────────────────────────────────────────
export const getQuotations = async (req, res) => {
  try {
    const { status, clientId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (clientId) filter.clientId = clientId;
    const list = await BulkQuotation.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createQuotation = async (req, res) => {
  try {
    const quoteId = `BQ-${Date.now()}`;
    const quotation = await BulkQuotation.create({ ...req.body, quotationId: quoteId });
    res.status(201).json({ success: true, data: quotation });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateQuotation = async (req, res) => {
  try {
    const quotation = await BulkQuotation.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!quotation) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: quotation });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateQuotationStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const quotation = await BulkQuotation.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!quotation) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: quotation });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteQuotation = async (req, res) => {
  try {
    await BulkQuotation.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DELIVERY SCHEDULES ────────────────────────────────────────────────────────
export const getSchedules = async (req, res) => {
  try {
    const list = await DeliverySchedule.find().sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createSchedule = async (req, res) => {
  try {
    const scheduleId = `SCH-${Date.now()}`;
    const schedule = await DeliverySchedule.create({ ...req.body, scheduleId });
    res.status(201).json({ success: true, data: schedule });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateSchedule = async (req, res) => {
  try {
    const schedule = await DeliverySchedule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!schedule) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: schedule });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const deleteSchedule = async (req, res) => {
  try {
    await DeliverySchedule.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── STATS ─────────────────────────────────────────────────────────────────────
export const getBulkStats = async (req, res) => {
  try {
    const activeClients = await CorporateClient.countDocuments({ status: 'Active' });
    const activeQuotes = await BulkQuotation.countDocuments({ status: 'Sent' });
    const approvedQuotes = await BulkQuotation.countDocuments({ status: 'Approved' });
    const pipeline = await BulkQuotation.aggregate([
      { $match: { status: { $in: ['Sent', 'Approved'] } } },
      { $group: { _id: null, total: { $sum: '$value' } } }
    ]);
    res.json({ success: true, data: {
      activeClients, activeQuotes, approvedQuotes,
      pipeline: pipeline[0]?.total || 0
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── CONVERT QUOTATION TO PURCHASE ORDER ──────────────────────────────────────
export const convertToPO = async (req, res) => {
  try {
    const PurchaseOrder = (await import('../models/PurchaseOrder.js')).default;

    const quote = await BulkQuotation.findById(req.params.id);
    if (!quote) return res.status(404).json({ success: false, message: 'Quotation not found' });
    if (quote.status === 'Converted') return res.status(400).json({ success: false, message: 'Already converted to PO' });

    // Generate PO ID
    const year = new Date().getFullYear();
    const prefix = `PO-${year}-`;
    const last = await PurchaseOrder.findOne({ poId: new RegExp(`^${prefix}`) }).sort({ poId: -1 });
    const num = last ? (parseInt(last.poId.split('-').pop()) || 0) : 0;
    const poId = `${prefix}${String(num + 1).padStart(3, '0')}`;

    // Map quotation items to PO items
    const items = (quote.items || []).map(it => ({
      name:      it.item || it.description || 'Item',
      qty:       it.qty  || 1,
      unit:      it.unit || 'Nos',
      basePrice: it.unitPrice || 0,
      gst:       18,
      total:     it.total || (it.qty * it.unitPrice) || 0,
    }));

    const subtotal   = items.reduce((s, i) => s + (i.basePrice * i.qty), 0);
    const gstTotal   = Math.round(subtotal * 0.18);
    const grandTotal = subtotal + gstTotal;

    // PO requires a vendor — use a placeholder if none linked
    // In a real flow the user would select a vendor; here we use the client as reference
    const po = await PurchaseOrder.create({
      poId,
      vendor:       req.body.vendorId || quote.clientId,  // caller can pass vendorId
      items,
      subtotal,
      gstTotal,
      grandTotal:   quote.grandTotal || grandTotal,
      paymentTerms: quote.paymentTerms || 'Net 30',
      remarks:      `Converted from Bulk Quotation ${quote.quoteId}`,
      status:       'Draft',
    });

    // Mark quotation as converted
    await BulkQuotation.findByIdAndUpdate(req.params.id, { status: 'Converted' });

    res.status(201).json({ success: true, data: po, message: `Purchase Order ${poId} created` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
export const convertToDispatch = async (req, res) => {
  try {
    const { Dispatch } = await import('../models/Logistics.js');

    const quote = await BulkQuotation.findById(req.params.id);
    if (!quote) return res.status(404).json({ success: false, message: 'Quotation not found' });
    if (quote.status !== 'Approved') return res.status(400).json({ success: false, message: 'Only Approved quotations can be converted' });

    // Generate dispatch ID
    const year = new Date().getFullYear();
    const prefix = `DSP-${year}-`;
    const last = await Dispatch.findOne({ dispatchId: new RegExp(`^${prefix}`) }).sort({ dispatchId: -1 });
    const num = last ? (parseInt(last.dispatchId.split('-').pop()) || 0) : 0;
    const dispatchId = `${prefix}${String(num + 1).padStart(3, '0')}`;

    const dispatch = await Dispatch.create({
      dispatchId,
      orderRef: quote.quoteId,
      customer: quote.clientName,
      destination: '',
      items: quote.items?.length || 0,
      value: quote.grandTotal || 0,
      status: 'Pending',
      instructions: `Converted from Bulk Quotation ${quote.quoteId}`,
    });

    // Update quotation status
    quote.status = 'Converted';
    await quote.save();

    res.status(201).json({ success: true, data: dispatch, message: `Dispatch ${dispatchId} created` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
