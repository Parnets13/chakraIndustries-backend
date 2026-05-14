import InvoiceClient from '../models/InvoiceClient.js';

export const getAllInvoiceClients = async (req, res) => {
  try {
    const { search, tier, gstCompliant, isActive } = req.query;
    const filter = {};
    
    if (tier) filter.tier = tier;
    if (gstCompliant !== undefined) filter.gstCompliant = gstCompliant === 'true';
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { clientCode: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } },
        { panNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    const clients = await InvoiceClient.find(filter)
      .populate('corporateClientId', 'name status')
      .sort({ createdAt: -1 });
      
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getInvoiceClientById = async (req, res) => {
  try {
    const client = await InvoiceClient.findById(req.params.id)
      .populate('corporateClientId');
      
    if (!client) {
      return res.status(404).json({ success: false, message: 'Invoice client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getInvoiceClientByCorporateId = async (req, res) => {
  try {
    const client = await InvoiceClient.findOne({ corporateClientId: req.params.corporateId })
      .populate('corporateClientId');
      
    if (!client) {
      return res.status(404).json({ success: false, message: 'Invoice client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateInvoiceClient = async (req, res) => {
  try {
    const client = await InvoiceClient.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true, runValidators: true }
    );
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Invoice client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getGSTCompliantClients = async (req, res) => {
  try {
    const clients = await InvoiceClient.find({ 
      gstCompliant: true, 
      isActive: true,
      gstNumber: { $exists: true, $ne: '' }
    })
      .populate('corporateClientId', 'name status')
      .sort({ clientName: 1 });
    
    res.json({ success: true, data: clients, count: clients.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getClientsByState = async (req, res) => {
  try {
    const { state } = req.params;
    const clients = await InvoiceClient.find({ 
      'billingAddress.state': state,
      isActive: true
    })
      .populate('corporateClientId', 'name status')
      .sort({ clientName: 1 });
    
    res.json({ success: true, data: clients, count: clients.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};