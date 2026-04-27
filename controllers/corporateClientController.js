import CorporateClient from '../models/CorporateClient.js';

const generateClientId = async () => {
  const last = await CorporateClient.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'CC-001';
  const num = parseInt(last.clientId.split('-')[1] || '0') + 1;
  return `CC-${String(num).padStart(3, '0')}`;
};

export const createCorporateClient = async (req, res) => {
  try {
    const clientId = await generateClientId();
    const client = await CorporateClient.create({ ...req.body, clientId });
    res.status(201).json({ success: true, data: client });
  } catch (err) {
    const message = err.message || 'Failed to create corporate client';
    res.status(400).json({ success: false, message });
  }
};

export const getAllCorporateClients = async (req, res) => {
  try {
    const { search, tier, status } = req.query;
    const filter = {};
    if (tier) filter.tier = tier;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { clientId: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }
    const clients = await CorporateClient.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getCorporateClientById = async (req, res) => {
  try {
    const client = await CorporateClient.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Corporate client not found' });
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateCorporateClient = async (req, res) => {
  try {
    const client = await CorporateClient.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!client) return res.status(404).json({ success: false, message: 'Corporate client not found' });
    res.json({ success: true, data: client });
  } catch (err) {
    const message = err.message || 'Failed to update corporate client';
    res.status(400).json({ success: false, message });
  }
};

export const deleteCorporateClient = async (req, res) => {
  try {
    const client = await CorporateClient.findByIdAndDelete(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Corporate client not found' });
    res.json({ success: true, message: 'Corporate client deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
