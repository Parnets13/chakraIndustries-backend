import MaterialReturn from '../models/MaterialReturn.js';

const genId = async (prefix, field) => {
  const year = new Date().getFullYear();
  const p = `${prefix}-${year}-`;
  const last = await MaterialReturn.findOne({ [field]: new RegExp(`^${p}`) }).sort({ [field]: -1 });
  if (!last) return `${p}001`;
  const num = parseInt(last[field].split('-')[2]) || 0;
  return `${p}${String(num + 1).padStart(3, '0')}`;
};

export const getAll = async (req, res) => {
  try {
    const { stage } = req.query;
    const filter = stage ? { stage } : {};
    const list = await MaterialReturn.find(filter)
      .populate('poId', 'poId')
      .populate('vendorId', 'companyName')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getStats = async (req, res) => {
  try {
    const total     = await MaterialReturn.countDocuments();
    const inTransit = await MaterialReturn.countDocuments({ stage: 'In-transit' });
    const pendingQC = await MaterialReturn.countDocuments({ stage: 'QC' });
    const closed    = await MaterialReturn.countDocuments({ stage: 'Closed' });
    res.json({ success: true, data: { total, inTransit, pendingQC, closed } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const create = async (req, res) => {
  try {
    const mrId     = await genId('MR', 'mrId');
    const docketId = await genId('DKT', 'docketId');
    const mr = await MaterialReturn.create({ ...req.body, mrId, docketId });
    res.status(201).json({ success: true, data: mr });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateStage = async (req, res) => {
  try {
    const mr = await MaterialReturn.findByIdAndUpdate(
      req.params.id,
      { stage: req.body.stage },
      { new: true }
    );
    if (!mr) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: mr });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const issueCreditNote = async (req, res) => {
  try {
    const { creditNoteId } = req.body;
    const mr = await MaterialReturn.findByIdAndUpdate(
      req.params.id,
      { creditNoteId },
      { new: true }
    );
    if (!mr) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: mr });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const remove = async (req, res) => {
  try {
    await MaterialReturn.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
