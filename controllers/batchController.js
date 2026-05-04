import Batch from '../models/Batch.js';

export const getAllBatches = async (req, res) => {
  try {
    console.log('=== GET /api/batches ===');
    console.log('Query:', req.query);
    console.log('Method:', req.method);
    
    const { status } = req.query;
    let query = {};
    if (status && status !== 'All') {
      query.status = status;
    }
    
    const batches = await Batch.find(query).sort({ createdAt: -1 });
    console.log('✓ Found', batches.length, 'batches');
    
    res.json({ success: true, data: batches });
  } catch (error) {
    console.error('✗ Error in getAllBatches:', error.message);
    res.status(500).json({ success: false, message: 'Error fetching batches', error: error.message });
  }
};

export const getBatchById = async (req, res) => {
  try {
    const batch = await Batch.findById(req.params.id);
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    res.json({ success: true, data: batch });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching batch', error: error.message });
  }
};

export const createBatch = async (req, res) => {
  try {
    const { sku, itemName, quantity, mfgDate, expiryDate, warehouse } = req.body;
    if (!sku || !quantity || !mfgDate || !expiryDate) {
      return res.status(400).json({ success: false, message: 'sku, quantity, mfgDate, and expiryDate are required' });
    }
    
    const batchNo = `BATCH-${String(await Batch.countDocuments() + 1).padStart(5, '0')}`;
    
    // Calculate shelf life percentage
    const mfgD = new Date(mfgDate);
    const expD = new Date(expiryDate);
    const totalDays = (expD - mfgD) / (1000 * 60 * 60 * 24);
    const remainingDays = (expD - new Date()) / (1000 * 60 * 60 * 24);
    const shelfLifePct = Math.max(0, Math.min(100, Math.round((remainingDays / totalDays) * 100)));
    
    const status = shelfLifePct < 20 ? 'Critical' : shelfLifePct < 0 ? 'Expired' : 'Active';
    
    const batch = new Batch({
      batchNo,
      sku,
      itemName,
      quantity,
      mfgDate: mfgD,
      expiryDate: expD,
      warehouse: warehouse || 'WH-01',
      shelfLifePercentage: shelfLifePct,
      status
    });
    
    await batch.save();
    res.status(201).json({ success: true, message: 'Batch created', data: batch });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error creating batch', error: error.message });
  }
};

export const updateBatch = async (req, res) => {
  try {
    const batch = await Batch.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    res.json({ success: true, message: 'Batch updated', data: batch });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error updating batch', error: error.message });
  }
};

export const deleteBatch = async (req, res) => {
  try {
    const batch = await Batch.findByIdAndDelete(req.params.id);
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    res.json({ success: true, message: 'Batch deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting batch', error: error.message });
  }
};
