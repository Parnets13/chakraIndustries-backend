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

// GET /api/rfqs/public/:id - Public access for vendors
export const getPublicRFQ = async (req, res) => {
  try {
    const rfq = await RFQ.findById(req.params.id)
      .populate('vendors', 'companyName vendorId contactPerson email phone')
      .populate('quotations.vendor', 'companyName vendorId')
      .select('-createdBy'); // Hide internal fields
    
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

    // Validate linked PR is approved (if provided)
    if (req.body.linkedPR) {
      const PurchaseRequisition = (await import('../models/PurchaseRequisition.js')).default;
      const pr = await PurchaseRequisition.findById(req.body.linkedPR);
      if (!pr) {
        return res.status(400).json({ success: false, message: 'Linked PR not found' });
      }
      if (pr.status !== 'Approved') {
        return res.status(400).json({ success: false, message: `Cannot create RFQ: PR ${pr.prId} is not approved (current status: ${pr.status})` });
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

// POST /api/rfqs/public/:id/quotations - Public quotation submission
export const addPublicQuotation = async (req, res) => {
  try {
    const rfq = await RFQ.findById(req.params.id)
      .populate('vendors', '_id companyName');
    
    if (!rfq) {
      return res.status(404).json({ success: false, message: 'RFQ not found' });
    }

    // Verify vendor is authorized for this RFQ
    const vendorId = req.body.vendor;
    const isAuthorized = rfq.vendors.some(v => v._id.toString() === vendorId);
    
    if (!isAuthorized) {
      return res.status(403).json({ success: false, message: 'Vendor not authorized for this RFQ' });
    }

    // Check if quotation already exists from this vendor
    const existingQuote = rfq.quotations.find(q => q.vendor.toString() === vendorId);
    if (existingQuote) {
      return res.status(400).json({ success: false, message: 'Quotation already submitted by this vendor' });
    }

    // Add quotation
    rfq.quotations.push({
      ...req.body,
      submittedAt: new Date()
    });
    rfq.status = 'Quoted';
    await rfq.save();
    
    res.json({ 
      success: true, 
      message: 'Quotation submitted successfully',
      data: { rfqId: rfq.rfqId }
    });
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
