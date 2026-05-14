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
