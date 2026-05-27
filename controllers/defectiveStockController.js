import DefectiveStock from '../models/DefectiveStock.js';
import DefectLog from '../models/DefectLog.js';

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

export const getDefectLogs = async (req, res) => {
  try {
    const logs = await DefectLog.find({ defectId: req.params.id }).sort({ createdAt: -1 });
    res.json({ success: true, data: logs });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Error fetching defect logs', error: error.message });
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

    // Create initial log
    await DefectLog.create({
      defectId: item._id,
      actionType: 'Created',
      title: 'Defect Entry Created',
      description: `New defective stock entry generated from ${source || 'System'}.`,
      currentStatus: item.stage,
      warehouse: item.warehouse,
      performedBy: req.user?.name || 'System'
    });

    res.status(201).json({ success: true, message: 'Defective stock item created', data: item });
  } catch (error) {
    res.status(400).json({ success: false, message: 'Error creating defective stock', error: error.message });
  }
};

export const updateDefectiveStock = async (req, res) => {
  try {
    const { stage } = req.body;
    const oldItem = await DefectiveStock.findById(req.params.id);
    if (!oldItem) return res.status(404).json({ success: false, message: 'Defective stock item not found' });

    const item = await DefectiveStock.findByIdAndUpdate(req.params.id, req.body, { new: true });
    
    // 1. Log Status Changes
    if (stage && stage !== oldItem.stage) {
      await DefectLog.create({
        defectId: item._id,
        actionType: 'Status Updated',
        title: 'Status Updated',
        description: `Defective item moved from ${oldItem.stage} to ${stage}.`,
        previousStatus: oldItem.stage,
        currentStatus: stage,
        warehouse: item.warehouse,
        performedBy: req.user?.name || 'System'
      });
    }

    // 2. Log Warehouse Changes
    if (req.body.warehouse && req.body.warehouse !== oldItem.warehouse) {
      await DefectLog.create({
        defectId: item._id,
        actionType: 'Warehouse Shifted',
        title: 'Warehouse Updated',
        description: `Item shifted from ${oldItem.warehouse} to ${req.body.warehouse}.`,
        currentStatus: item.stage,
        warehouse: req.body.warehouse,
        performedBy: req.user?.name || 'System'
      });
    }

    // 3. Log General Stock Updates (if quantity changed)
    if (req.body.quantity !== undefined && req.body.quantity !== oldItem.quantity) {
      await DefectLog.create({
        defectId: item._id,
        actionType: 'Stock Updated',
        title: 'Quantity Adjusted',
        description: `Quantity updated from ${oldItem.quantity} to ${req.body.quantity}.`,
        currentStatus: item.stage,
        warehouse: item.warehouse,
        performedBy: req.user?.name || 'System'
      });
    }

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
