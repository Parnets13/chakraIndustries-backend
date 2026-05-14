import DispatchClient from '../models/DispatchClient.js';

export const getAllDispatchClients = async (req, res) => {
  try {
    const { search, city, pincode, isActive } = req.query;
    const filter = {};
    
    if (city) filter['deliveryAddress.city'] = { $regex: city, $options: 'i' };
    if (pincode) filter['deliveryAddress.pincode'] = pincode;
    if (isActive !== undefined) filter.isActive = isActive === 'true';
    
    if (search) {
      filter.$or = [
        { clientName: { $regex: search, $options: 'i' } },
        { clientCode: { $regex: search, $options: 'i' } },
        { 'deliveryAddress.city': { $regex: search, $options: 'i' } },
        { 'deliveryAddress.pincode': { $regex: search, $options: 'i' } }
      ];
    }
    
    const clients = await DispatchClient.find(filter)
      .populate('corporateClientId', 'name status')
      .sort({ createdAt: -1 });
      
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDispatchClientById = async (req, res) => {
  try {
    const client = await DispatchClient.findById(req.params.id)
      .populate('corporateClientId');
      
    if (!client) {
      return res.status(404).json({ success: false, message: 'Dispatch client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDispatchClientByCorporateId = async (req, res) => {
  try {
    const client = await DispatchClient.findOne({ corporateClientId: req.params.corporateId })
      .populate('corporateClientId');
      
    if (!client) {
      return res.status(404).json({ success: false, message: 'Dispatch client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateDispatchClient = async (req, res) => {
  try {
    const client = await DispatchClient.findByIdAndUpdate(
      req.params.id, 
      req.body, 
      { new: true, runValidators: true }
    );
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Dispatch client not found' });
    }
    
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateDeliveryStats = async (req, res) => {
  try {
    const { successful = true, deliveryTime = 0 } = req.body;
    const client = await DispatchClient.findById(req.params.id);
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Dispatch client not found' });
    }
    
    await client.updateDeliveryStats(successful, deliveryTime);
    
    res.json({ 
      success: true, 
      data: client,
      message: 'Delivery stats updated successfully' 
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getClientsByCity = async (req, res) => {
  try {
    const { city } = req.params;
    const clients = await DispatchClient.find({ 
      'deliveryAddress.city': { $regex: city, $options: 'i' },
      isActive: true
    })
      .populate('corporateClientId', 'name status')
      .sort({ clientName: 1 });
    
    res.json({ success: true, data: clients, count: clients.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getClientsByPincode = async (req, res) => {
  try {
    const { pincode } = req.params;
    const clients = await DispatchClient.find({ 
      'deliveryAddress.pincode': pincode,
      isActive: true
    })
      .populate('corporateClientId', 'name status')
      .sort({ clientName: 1 });
    
    res.json({ success: true, data: clients, count: clients.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getDeliveryStats = async (req, res) => {
  try {
    const stats = await DispatchClient.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: null,
          totalClients: { $sum: 1 },
          totalDeliveries: { $sum: '$deliveryStats.totalDeliveries' },
          successfulDeliveries: { $sum: '$deliveryStats.successfulDeliveries' },
          failedDeliveries: { $sum: '$deliveryStats.failedDeliveries' },
          avgDeliveryTime: { $avg: '$deliveryStats.averageDeliveryTime' },
          avgRating: { $avg: '$deliveryStats.deliveryRating' }
        }
      }
    ]);
    
    const result = stats[0] || {
      totalClients: 0,
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      avgDeliveryTime: 0,
      avgRating: 0
    };
    
    result.successRate = result.totalDeliveries > 0 
      ? ((result.successfulDeliveries / result.totalDeliveries) * 100).toFixed(2)
      : 0;
    
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};