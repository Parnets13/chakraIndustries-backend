import CorporateClient from '../models/CorporateClient.js';
import DynamicDataFlowService from '../services/dynamicDataFlowService.js';

const generateClientId = async () => {
  const last = await CorporateClient.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'CC-001';
  const num = parseInt(last.clientId.split('-')[1] || '0') + 1;
  return `CC-${String(num).padStart(3, '0')}`;
};

export const createCorporateClient = async (req, res) => {
  try {
    const clientId = await generateClientId();
    const clientData = { 
      ...req.body, 
      clientId,
      createdBy: req.user?._id,
      updatedBy: req.user?._id
    };
    
    const client = await CorporateClient.create(clientData);
    
    // Trigger dynamic data flow propagation
    const flowResult = await DynamicDataFlowService.propagateCorporateClientData(client._id, 'create');
    
    res.status(201).json({ 
      success: true, 
      data: client,
      dataFlow: flowResult,
      message: 'Corporate client created and integrated successfully'
    });
  } catch (err) {
    const message = err.message || 'Failed to create corporate client';
    res.status(400).json({ success: false, message });
  }
};

export const getAllCorporateClients = async (req, res) => {
  try {
    const { search, tier, status, syncStatus } = req.query;
    const filter = {};
    
    if (tier) filter.tier = tier;
    if (status) filter.status = status;
    if (syncStatus) filter['tallySync.syncStatus'] = syncStatus;
    
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { clientId: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { 'address.city': { $regex: search, $options: 'i' } },
        { gstNumber: { $regex: search, $options: 'i' } }
      ];
    }
    
    const clients = await CorporateClient.find(filter)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .sort({ createdAt: -1 });
      
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getCorporateClientById = async (req, res) => {
  try {
    const client = await CorporateClient.findById(req.params.id)
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name');
      
    if (!client) {
      return res.status(404).json({ success: false, message: 'Corporate client not found' });
    }
    
    // Get integration status
    const integrationStatus = await DynamicDataFlowService.getClientIntegrationStatus(client._id);
    
    res.json({ 
      success: true, 
      data: client,
      integrationStatus: integrationStatus.success ? integrationStatus : null
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCorporateClient = async (req, res) => {
  try {
    const updateData = { 
      ...req.body, 
      updatedBy: req.user?._id 
    };
    
    const client = await CorporateClient.findByIdAndUpdate(
      req.params.id, 
      updateData, 
      { new: true, runValidators: true }
    );
    
    if (!client) {
      return res.status(404).json({ success: false, message: 'Corporate client not found' });
    }
    
    // Trigger dynamic data flow propagation for updates
    const flowResult = await DynamicDataFlowService.propagateCorporateClientData(client._id, 'update');
    
    res.json({ 
      success: true, 
      data: client,
      dataFlow: flowResult,
      message: 'Corporate client updated and synced successfully'
    });
  } catch (err) {
    const message = err.message || 'Failed to update corporate client';
    res.status(400).json({ success: false, message });
  }
};

export const deleteCorporateClient = async (req, res) => {
  try {
    const client = await CorporateClient.findByIdAndDelete(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Corporate client not found' });
    }
    
    res.json({ success: true, message: 'Corporate client deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// New endpoints for dynamic data flow management

export const syncClientWithTally = async (req, res) => {
  try {
    const client = await CorporateClient.findById(req.params.id);
    if (!client) {
      return res.status(404).json({ success: false, message: 'Corporate client not found' });
    }
    
    const flowResult = await DynamicDataFlowService.propagateCorporateClientData(client._id, 'sync');
    
    res.json({
      success: true,
      data: flowResult,
      message: 'Client sync completed'
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const bulkSyncClients = async (req, res) => {
  try {
    const result = await DynamicDataFlowService.bulkSyncWithTally();
    
    res.json({
      success: true,
      data: result,
      message: result.message
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getClientIntegrationStatus = async (req, res) => {
  try {
    const result = await DynamicDataFlowService.getClientIntegrationStatus(req.params.id);
    
    if (!result.success) {
      return res.status(404).json(result);
    }
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getClientsByTier = async (req, res) => {
  try {
    const { tier } = req.params;
    const clients = await CorporateClient.getByTier(tier);
    
    res.json({
      success: true,
      data: clients,
      count: clients.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getPendingTallySync = async (req, res) => {
  try {
    const clients = await CorporateClient.getPendingTallySync();
    
    res.json({
      success: true,
      data: clients,
      count: clients.length
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
