import QuotationClient from '../models/QuotationClient.js';

export const getAllQuotationClients = async (req, res) => {
  try {
    const { search, tier, isActive } = req.query;
    const filter = {};
    
    if (tier) filter.tier = tier;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { clientCode: { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    const clients = await QuotationClient.find(filter)
      .populate('corporateClientId', 'name status')
      .sort({ createdAt: -1 });
      
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuotationClientById = async (req, res) => {
  try {
    const client = await QuotationClient.findById(req.params.id)
      .populate('corporateClientId');
      
    if (!client) {
      return res.status(404).json({ success: false, message: 'Quotation client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getQuotationClientByCorporateId = async (req, res) => {
  try {
    const client = await QuotationClient.findOne({ corporateClientId: req.params.corporateId })
      .populate('corporateClientId');
      
    if (!client) {
      return res.status(404).json({ success: false, message: 'Quotation client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateQuotationClient = async (req, res) => {
  try {
    const client = await QuotationClient.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true, runValidators: true }
    );
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Quotation client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getQuotationClientsByTier = async (req, res) => {
  try {
    const { tier } = req.params;
    const clients = await QuotationClient.find({ tier, isActive: true })
      .populate('corporateClientId', 'name status')
      .sort({ clientName: 1 });
    
    res.json({ success: true, data: clients, count: clients.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};