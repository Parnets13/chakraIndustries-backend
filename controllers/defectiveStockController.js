import DefectiveStock from '../models/DefectiveStock.js';

export const getAllDefectiveStock = async (req, res) => {
  try {
    const { stage } = req.query;
    let query = {};
    if (stage && stage !== 'All') {
      query.stage = stage;
    }
    const items = await DefectiveStock.find(query).sort({ createdAt: -1 });
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching defective stock', error: error.message });
  }
};

export const getDefectiveStockById = async (req, res) => {
  try {
    const item = await DefectiveStock.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Defective stock item not found' });
    res.json({ success: true, data: item });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching defective stock', error: error.message });
  }
};

export const createDefectiveStock = async (req, res) => {
  try {
    const { sku, itemName, quantity, defectType, source, stage, warehouse, remarks } = req.body;
    if (!sku || !quantity) {
      return res.status(400).json({ success: false, message: 'sku and quantity are required' });
    }
    
    const defectId = `DEF-${String(await DefectiveStock.countDocuments() + 1).padStart(5, '0')}`;
    
    const item = new DefectiveStock({
      defectId,
      sku,
      itemName,
      quantity,
      defectType: defectType || 'Other',
      source: source || 'GRN Inspection',
      stage: stage || 'QC Hold',
      warehouse: warehouse || 'WH-01',
      remarks,
      daysAged: 0
    });
    
    await item.save();
    res.status(201).json({ success: true, message: 'Defective stock item created', data: item });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error creating defective stock', error: error.message });
  }
};

export const updateDefectiveStock = async (req, res) => {
  try {
    const item = await DefectiveStock.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!item) return res.status(404).json({ success: false, message: 'Defective stock item not found' });
    res.json({ success: true, message: 'Defective stock updated', data: item });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error updating defective stock', error: error.message });
  }
};

export const deleteDefectiveStock = async (req, res) => {
  try {
    const item = await DefectiveStock.findByIdAndDelete(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: 'Defective stock item not found' });
    res.json({ success: true, message: 'Defective stock deleted' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error deleting defective stock', error: error.message });
  }
};
