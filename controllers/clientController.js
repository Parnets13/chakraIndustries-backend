import Client from '../models/Client.js';

// Auto-generate client ID like ESME-001, ESME-002...
const generateClientId = async () => {
  const last = await Client.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'ESME-001';
  const num = parseInt(last.clientId.split('-')[1] || '0') + 1;
  return `ESME-${String(num).padStart(3, '0')}`;
};

// POST /api/clients
export const createClient = async (req, res) => {
  try {
    const clientId = await generateClientId();
    const client = await Client.create({ ...req.body, clientId });
    res.status(201).json({ success: true, data: client });
  } catch (err) {
    const message = err.message || 'Failed to create client';
    res.status(400).json({ success: false, message });
  }
};

// GET /api/clients
export const getAllClients = async (req, res) => {
  try {
    const { search, category, status } = req.query;
    const filter = {};
    if (category) filter.category = category;
    if (status) filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { clientId: { $regex: search, $options: 'i' } },
        { contact: { $regex: search, $options: 'i' } },
        { city: { $regex: search, $options: 'i' } },
      ];
    }
    const clients = await Client.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: clients });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/clients/:id
export const getClientById = async (req, res) => {
  try {
    const client = await Client.findById(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, data: client });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/clients/:id
export const updateClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, data: client });
  } catch (err) {
    const message = err.message || 'Failed to update client';
    res.status(400).json({ success: false, message });
  }
};

// DELETE /api/clients/:id
export const deleteClient = async (req, res) => {
  try {
    const client = await Client.findByIdAndDelete(req.params.id);
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });
    res.json({ success: true, message: 'Client deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
