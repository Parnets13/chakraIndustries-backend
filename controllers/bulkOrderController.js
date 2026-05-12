import { CorporateClient, BulkQuotation, DeliverySchedule } from '../models/BulkOrder.js';

// ── ID generators ─────────────────────────────────────────────────────────────
const genId = async (Model, field, prefix) => {
  const year = new Date().getFullYear();
  const p = `${prefix}-${year}-`;
  const last = await Model.findOne({ [field]: new RegExp(`^${p}`) }).sort({ [field]: -1 });
  if (!last) return `${p}001`;
  const num = parseInt(last[field].split('-').pop()) || 0;
  return `${p}${String(num + 1).padStart(3, '0')}`;
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
    const clientId = await genId(CorporateClient, 'clientId', 'CC');
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
    const list = await BulkQuotation.find(filter).populate('clientId', 'name tier').sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createQuotation = async (req, res) => {
  try {
    const quoteId = await genId(BulkQuotation, 'quoteId', 'BQ');
    const quotation = await BulkQuotation.create({ ...req.body, quoteId });
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
    const list = await DeliverySchedule.find().populate('quoteId', 'quoteId').sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const createSchedule = async (req, res) => {
  try {
    const scheduleId = await genId(DeliverySchedule, 'scheduleId', 'SCH');
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
    const activeClients   = await CorporateClient.countDocuments({ status: 'Active' });
    const activeQuotes    = await BulkQuotation.countDocuments({ status: 'Sent' });
    const approvedQuotes  = await BulkQuotation.countDocuments({ status: 'Approved' });
    const pipeline        = await BulkQuotation.aggregate([
      { $match: { status: { $in: ['Sent', 'Approved'] } } },
      { $group: { _id: null, total: { $sum: '$grandTotal' } } },
    ]);
    res.json({ success: true, data: {
      activeClients, activeQuotes, approvedQuotes,
      pipeline: pipeline[0]?.total || 0,
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── CONVERT QUOTATION TO DISPATCH ─────────────────────────────────────────────
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
