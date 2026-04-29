import PurchaseOrder from '../models/PurchaseOrder.js';

// Generate PO ID
const generatePOId = async () => {
  const year = new Date().getFullYear();
  const lastPO = await PurchaseOrder.findOne({ poId: new RegExp(`^PO-${year}-`) })
    .sort({ poId: -1 })
    .limit(1);
  
  if (!lastPO) return `PO-${year}-001`;
  
  const lastNum = parseInt(lastPO.poId.split('-')[2]);
  const newNum = String(lastNum + 1).padStart(3, '0');
  return `PO-${year}-${newNum}`;
};

// Get all POs
export const getAllPOs = async (req, res) => {
  try {
    const { status, vendor } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendor) filter.vendor = vendor;

    const pos = await PurchaseOrder.find(filter)
      .populate('vendor', 'companyName')
      .populate('linkedRFQ', 'rfqId title')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: pos });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get PO by ID
export const getPOById = async (req, res) => {
  try {
    const po = await PurchaseOrder.findById(req.params.id)
      .populate('vendor')
      .populate('linkedRFQ');
    
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }
    
    res.json({ success: true, data: po });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create PO
export const createPO = async (req, res) => {
  try {
    // Validate vendor exists
    const Vendor = (await import('../models/Vendor.js')).default;
    const vendor = await Vendor.findById(req.body.vendor);
    if (!vendor) {
      return res.status(400).json({ success: false, message: 'Vendor not found' });
    }
    if (vendor.status === 'Blacklisted') {
      return res.status(400).json({ success: false, message: 'Cannot create PO for blacklisted vendor' });
    }

    // If linked to an RFQ, validate the RFQ's linked PR is approved
    if (req.body.linkedRFQ) {
      const RFQ = (await import('../models/RFQ.js')).default;
      const rfq = await RFQ.findById(req.body.linkedRFQ).populate('linkedPR');
      if (!rfq) {
        return res.status(400).json({ success: false, message: 'Linked RFQ not found' });
      }
      if (rfq.linkedPR && rfq.linkedPR.status !== 'Approved') {
        return res.status(400).json({
          success: false,
          message: `Cannot create PO: PR ${rfq.linkedPR.prId} linked to this RFQ is not approved (status: ${rfq.linkedPR.status}). Please approve the PR first.`,
        });
      }
    }

    const poId = await generatePOId();
    
    // Calculate totals
    const items = req.body.items.map(item => ({
      ...item,
      total: item.qty * item.basePrice * (1 + item.gst / 100)
    }));
    
    const subtotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice), 0);
    const gstTotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice * item.gst / 100), 0);
    const grandTotal = subtotal + gstTotal;
    
    const po = new PurchaseOrder({
      ...req.body,
      poId,
      items,
      subtotal,
      gstTotal,
      grandTotal
    });
    
    await po.save();
    await po.populate('vendor', 'companyName');
    
    res.status(201).json({ success: true, data: po });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Update PO
export const updatePO = async (req, res) => {
  try {
    // Recalculate totals if items changed
    if (req.body.items) {
      const items = req.body.items.map(item => ({
        ...item,
        total: item.qty * item.basePrice * (1 + item.gst / 100)
      }));
      
      req.body.subtotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice), 0);
      req.body.gstTotal = items.reduce((sum, item) => sum + (item.qty * item.basePrice * item.gst / 100), 0);
      req.body.grandTotal = req.body.subtotal + req.body.gstTotal;
      req.body.items = items;
    }
    
    const po = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('vendor', 'companyName');
    
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }
    
    res.json({ success: true, data: po });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Update PO status
export const updatePOStatus = async (req, res) => {
  try {
    const { status } = req.body;
    
    const po = await PurchaseOrder.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('vendor', 'companyName');
    
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }
    
    res.json({ success: true, data: po });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete PO
export const deletePO = async (req, res) => {
  try {
    const po = await PurchaseOrder.findByIdAndDelete(req.params.id);
    
    if (!po) {
      return res.status(404).json({ success: false, message: 'PO not found' });
    }
    
    res.json({ success: true, message: 'PO deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
