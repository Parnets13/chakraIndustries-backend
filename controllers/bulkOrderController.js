import BulkOrder from '../models/BulkOrder.js';
import BulkQuotation from '../models/BulkQuotation.js';
import CorporateClient from '../models/CorporateClient.js';
import DeliverySchedule from '../models/DeliverySchedule.js';
import XLSX from 'xlsx';

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

// Import multiple clients from frontend-parsed Excel/JSON
export const importClients = async (req, res) => {
  try {
    const list = req.body?.clients;
    if (!Array.isArray(list)) return res.status(400).json({ success: false, message: 'Invalid payload: clients array required' });

    const created = [];
    for (let i = 0; i < list.length; i++) {
      const c = list[i] || {};
      const clientId = `CC-${Date.now()}-${Math.floor(Math.random()*9000)+1000}-${i}`;
      const payload = {
        name: c.name || c.companyName || c.company || '',
        contact: c.contact || c.contactPerson || '',
        phone: c.phone || c.mobile || c.phoneNumber || '',
        email: c.email || c.emailAddress || '',
        city: c.city || '',
        category: c.category || c.tier || 'Trading',
        creditLimit: Number(c.creditLimit || c.credit || 0) || 0,
        gstNumber: c.gstNumber || c.gstin || '',
        address: c.address || '',
        status: c.status || 'Active',
        clientId,
      };
      const doc = await CorporateClient.create(payload);
      created.push(doc);
    }

    res.status(201).json({ success: true, data: created, message: `${created.length} clients imported` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// Import clients from uploaded Excel file (multipart/form-data 'file')
export const importClientsFromFile = async (req, res) => {
  try {
    const file = req.file;
    if (!file || !file.buffer) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const wb = XLSX.read(file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    if (!Array.isArray(rows) || rows.length === 0) return res.status(400).json({ success: false, message: 'Excel sheet is empty' });

    // Map rows to client payloads
    const mapped = rows.map((r, i) => ({
      name: r['Company Name'] || r['name'] || r['Company'] || r['companyName'] || '',
      contact: r['Contact Person'] || r['contact'] || '',
      phone: String(r['Phone'] || r['Mobile'] || r['phone'] || '').trim(),
      email: r['Email'] || r['email'] || '',
      city: r['City'] || r['city'] || '',
      category: r['Category'] || r['Tier'] || r['category'] || 'Trading',
      creditLimit: Number(r['Credit Limit'] || r['creditLimit'] || 0) || 0,
      gstNumber: r['GST Number'] || r['gstNumber'] || r['Gstin'] || '',
      address: r['Address'] || r['address'] || '',
      status: r['Status'] || 'Active',
    }));

    // Insert many (avoid duplicates by simple name check) — basic validation
    const toCreate = [];
    for (const c of mapped) {
      if (!c.name) continue;
      // Skip if exact name already exists
      const exists = await CorporateClient.findOne({ name: c.name });
      if (exists) continue;
      const clientId = `CC-${Date.now()}-${Math.floor(Math.random()*9000)+1000}`;
      toCreate.push({ ...c, clientId });
    }

    let created = [];
    if (toCreate.length > 0) created = await CorporateClient.insertMany(toCreate);

    res.status(201).json({ success: true, data: created, message: `${created.length} clients imported`, skipped: mapped.length - toCreate.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
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

    // Map quotation line items to PO items
    const items = (Array.isArray(quote.lineItems) ? quote.lineItems : []).map(it => ({
      name:      it.item || it.description || 'Item',
      qty:       it.qty || 1,
      unit:      it.unit || 'Nos',
      basePrice: it.unitPrice || 0,
      gst:       18,
      total:     it.total || ((it.qty || 0) * (it.unitPrice || 0)),
    }));

    const subtotal   = items.reduce((s, i) => s + (i.basePrice * i.qty), 0);
    const gstTotal   = Math.round(subtotal * 0.18);
    const grandTotal = subtotal + gstTotal;

    // PO requires a vendor. Try the supplied vendorId first, then match by client name.
    let vendorId = req.body.vendorId;
    const clientName = (quote.client || '').trim();
    if (!vendorId && clientName) {
      const Vendor = (await import('../models/Vendor.js')).default;
      const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const existingVendor = await Vendor.findOne({ companyName: { $regex: `^${escapeRegExp(clientName)}$`, $options: 'i' } });
      if (existingVendor) vendorId = existingVendor._id;
      else {
        const newVendor = await Vendor.create({ companyName: clientName, status: 'Active' });
        vendorId = newVendor._id;
      }
    }

    if (!vendorId) {
      return res.status(400).json({ success: false, message: 'Vendor is required to convert quotation to PO' });
    }

    const po = await PurchaseOrder.create({
      poId,
      vendor:       vendorId,
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
      items: Array.isArray(quote.lineItems) ? quote.lineItems.length : 0,
      value: quote.grandTotal || quote.value || 0,
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
