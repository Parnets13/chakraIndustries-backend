import BulkQuotation from '../models/BulkQuotation.js';

const generateQuotationId = async () => {
  const last = await BulkQuotation.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'BQ-2024-001';
  const num = parseInt(last.quotationId.split('-')[2] || '0') + 1;
  return `BQ-2024-${String(num).padStart(3, '0')}`;
};

export const createBulkQuotation = async (req, res) => {
  try {
    const quotationId = await generateQuotationId();
    const quotation = await BulkQuotation.create({ ...req.body, quotationId });
    res.status(201).json({ success: true, data: quotation });
  } catch (err) {
    const message = err.message || 'Failed to create bulk quotation';
    res.status(400).json({ success: false, message });
  }
};

export const getAllBulkQuotations = async (req, res) => {
  try {
    const { search, status, client } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (client) filter.client = { $regex: client, $options: 'i' };
    if (search) {
      filter.$or = [
        { quotationId: { $regex: search, $options: 'i' } },
        { client: { $regex: search, $options: 'i' } },
      ];
    }
    const quotations = await BulkQuotation.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: quotations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getBulkQuotationById = async (req, res) => {
  try {
    const quotation = await BulkQuotation.findById(req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Bulk quotation not found' });
    res.json({ success: true, data: quotation });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateBulkQuotation = async (req, res) => {
  try {
    const quotation = await BulkQuotation.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!quotation) return res.status(404).json({ success: false, message: 'Bulk quotation not found' });
    res.json({ success: true, data: quotation });
  } catch (err) {
    const message = err.message || 'Failed to update bulk quotation';
    res.status(400).json({ success: false, message });
  }
};

export const deleteBulkQuotation = async (req, res) => {
  try {
    const quotation = await BulkQuotation.findByIdAndDelete(req.params.id);
    if (!quotation) return res.status(404).json({ success: false, message: 'Bulk quotation not found' });
    res.json({ success: true, message: 'Bulk quotation deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
