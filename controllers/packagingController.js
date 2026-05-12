import Packaging from '../models/Packaging.js';

// Generate unique packaging ID
const generatePackagingId = async () => {
  const count = await Packaging.countDocuments();
  return `PKG-${String(count + 1).padStart(3, '0')}`;
};

// Get all packaging options
export const getAllPackaging = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const packaging = await Packaging.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: packaging });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get packaging by ID
export const getPackagingById = async (req, res) => {
  try {
    const packaging = await Packaging.findById(req.params.id);
    if (!packaging) {
      return res.status(404).json({ success: false, message: 'Packaging not found' });
    }
    res.json({ success: true, data: packaging });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Create new packaging option
export const createPackaging = async (req, res) => {
  try {
    const { name, description, type, moq, extraCost, extraCostValue, leadTime, leadTimeDays } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Packaging name is required' });
    }

    const packagingId = await generatePackagingId();

    const packaging = await Packaging.create({
      packagingId,
      name,
      description,
      type: type || 'Standard',
      moq: moq || 100,
      extraCost: extraCost || '₹0',
      extraCostValue: extraCostValue || 0,
      leadTime: leadTime || '0 days',
      leadTimeDays: leadTimeDays || 0,
      status: 'Active',
      createdBy: req.user?.id
    });

    res.status(201).json({ success: true, message: 'Packaging created', data: packaging });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Update packaging option
export const updatePackaging = async (req, res) => {
  try {
    const packaging = await Packaging.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: Date.now() },
      { new: true, runValidators: true }
    );

    if (!packaging) {
      return res.status(404).json({ success: false, message: 'Packaging not found' });
    }

    res.json({ success: true, message: 'Packaging updated', data: packaging });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

// Delete packaging option
export const deletePackaging = async (req, res) => {
  try {
    const packaging = await Packaging.findByIdAndDelete(req.params.id);

    if (!packaging) {
      return res.status(404).json({ success: false, message: 'Packaging not found' });
    }

    res.json({ success: true, message: 'Packaging deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get packaging by type
export const getPackagingByType = async (req, res) => {
  try {
    const { type } = req.params;
    const packaging = await Packaging.find({ type, status: 'Active' }).sort({ createdAt: -1 });
    res.json({ success: true, data: packaging });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get active packaging options
export const getActivePackaging = async (req, res) => {
  try {
    const packaging = await Packaging.find({ status: 'Active' }).sort({ createdAt: -1 });
    res.json({ success: true, data: packaging });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
