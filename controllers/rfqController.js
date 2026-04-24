import RFQ from '../models/RFQ.js';

// Generate RFQ ID (RFQ-2026-001)
const generateRFQId = async () => {
  const year = new Date().getFullYear();
  const prefix = `RFQ-${year}-`;
  
  const lastRFQ = await RFQ.findOne({ rfqId: new RegExp(`^${prefix}`) })
    .sort({ rfqId: -1 })
    .limit(1);
  
  if (!lastRFQ) return `${prefix}001`;
  
  const lastNum = parseInt(lastRFQ.rfqId.split('-')[2]);
  const nextNum = (lastNum + 1).toString().padStart(3, '0');
  return `${prefix}${nextNum}`;
};

// GET /api/rfqs
export const getAllRFQs = async (req, res) => {
  try {
    const { status, priority } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (priority) filter.priority = priority;

    const rfqs = await RFQ.find(filter)
      .populate('vendors', 'companyName vendorId')
      .populate('linkedPR', 'prId department')
      .populate('quotations.vendor', 'companyName vendorId')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: rfqs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/rfqs/:id
export const getRFQById = async (req, res) => {
  try {
    const rfq = await RFQ.findById(req.params.id)
      .populate('vendors', 'companyName vendorId contactPerson email phone')
      .populate('linkedPR', 'prId department items totalValue')
      .populate('quotations.vendor', 'companyName vendorId');
    
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }
    
    res.json({ success: true, data: rfq });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST /api/rfqs
export const createRFQ = async (req, res) => {
  try {
    // Validate vendors exist
    if (req.body.vendors && req.body.vendors.length > 0) {
      const Vendor = (await import('../models/Vendor.js')).default;
      const vendorCount = await Vendor.countDocuments({ _id: { $in: req.body.vendors } });
      if (vendorCount !== req.body.vendors.length) {
        return res.status(400).json({ success: false, message: 'One or more vendors not found' });
      }
    }

    const rfqId = await generateRFQId();
    
    const rfq = await RFQ.create({
      ...req.body,
      rfqId
    });
    
    const populated = await RFQ.findById(rfq._id)
      .populate('vendors', 'companyName vendorId')
      .populate('linkedPR', 'prId department');
    
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PUT /api/rfqs/:id
export const updateRFQ = async (req, res) => {
  try {
    const rfq = await RFQ.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate('vendors', 'companyName vendorId')
      .populate('linkedPR', 'prId department');
    
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }
    
    res.json({ success: true, data: rfq });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/rfqs/:id/status
export const updateRFQStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const rfq = await RFQ.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    )
      .populate('vendors', 'companyName vendorId')
      .populate('linkedPR', 'prId department');
    
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }
    
    res.json({ success: true, data: rfq });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// POST /api/rfqs/:id/quotations
export const addQuotation = async (req, res) => {
  try {
    const rfq = await RFQ.findById(req.params.id);
    
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }
    
    rfq.quotations.push(req.body);
    rfq.status = 'Quoted';
    await rfq.save();
    
    const populated = await RFQ.findById(rfq._id)
      .populate('vendors', 'companyName vendorId')
      .populate('quotations.vendor', 'companyName vendorId');
    
    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/rfqs/:id
export const deleteRFQ = async (req, res) => {
  try {
    const rfq = await RFQ.findByIdAndDelete(req.params.id);
    
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }
    
    res.json({ success: true, message: 'RFQ deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
