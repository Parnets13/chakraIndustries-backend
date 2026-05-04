import Asset from '../models/Asset.js';

const genAssetId = async () => {
  const last = await Asset.findOne().sort({ createdAt: -1 });
  if (!last) return 'AST-001';
  const num = parseInt(last.assetId.replace('AST-', '')) || 0;
  return `AST-${String(num + 1).padStart(3, '0')}`;
};

// GET /api/assets
export const getAll = async (req, res) => {
  try {
    const { status, category, search } = req.query;
    const filter = {};
    if (status)   filter.status = status;
    if (category) filter.category = category;
    if (search)   filter.name = new RegExp(search, 'i');
    const assets = await Asset.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: assets });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// GET /api/assets/:id
export const getById = async (req, res) => {
  try {
    const asset = await Asset.findById(req.params.id);
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });
    res.json({ success: true, data: asset });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/assets
export const create = async (req, res) => {
  try {
    const assetId = await genAssetId();
    const asset = await Asset.create({ ...req.body, assetId });
    res.status(201).json({ success: true, data: asset });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// PUT /api/assets/:id
export const update = async (req, res) => {
  try {
    const { assetId, maintenanceLogs, ...updateData } = req.body;
    const asset = await Asset.findByIdAndUpdate(
      req.params.id,
      { $set: updateData },
      { new: true, runValidators: true }
    );
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });
    res.json({ success: true, data: asset });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// DELETE /api/assets/:id
export const remove = async (req, res) => {
  try {
    await Asset.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Asset deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// POST /api/assets/:id/maintenance
export const addMaintenanceLog = async (req, res) => {
  try {
    const { type, technician, description, cost, date, status, nextMaintDate } = req.body;
    const updateFields = {
      $push: { maintenanceLogs: { type, technician, description, cost: cost || 0, date: date || new Date(), status: status || 'Scheduled' } },
    };
    // Update asset status and next maintenance date if provided
    if (status === 'In Progress') updateFields.$set = { status: 'Maintenance' };
    if (status === 'Completed')   updateFields.$set = { status: 'Active' };
    if (nextMaintDate)            updateFields.$set = { ...updateFields.$set, nextMaintDate };

    const asset = await Asset.findByIdAndUpdate(req.params.id, updateFields, { new: true });
    if (!asset) return res.status(404).json({ success: false, message: 'Asset not found' });
    res.json({ success: true, data: asset });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

// GET /api/assets/stats/summary
export const getSummary = async (req, res) => {
  try {
    const [total, active, maintenance, inactive, disposed] = await Promise.all([
      Asset.countDocuments(),
      Asset.countDocuments({ status: 'Active' }),
      Asset.countDocuments({ status: 'Maintenance' }),
      Asset.countDocuments({ status: 'Inactive' }),
      Asset.countDocuments({ status: 'Disposed' }),
    ]);
    const valueAgg = await Asset.aggregate([
      { $group: { _id: null, totalPurchase: { $sum: '$purchaseValue' }, totalCurrent: { $sum: '$currentValue' } } }
    ]);
    const vals = valueAgg[0] || { totalPurchase: 0, totalCurrent: 0 };
    res.json({ success: true, data: { total, active, maintenance, inactive, disposed, totalPurchaseValue: vals.totalPurchase, totalCurrentValue: vals.totalCurrent } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
