import DebitNote from '../models/DebitNote.js';

const genDNId = async () => {
  const year = new Date().getFullYear();
  const prefix = `DN-${year}-`;
  const last = await DebitNote.findOne({ dnId: new RegExp(`^${prefix}`) }).sort({ dnId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.dnId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

export const getAll = async (req, res) => {
  try {
    const { status, vendorId } = req.query;
    const filter = {};
    if (status) filter.approvalStatus = status;
    if (vendorId) filter.vendorId = vendorId;
    const list = await DebitNote.find(filter)
      .populate('vendorId')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getStats = async (req, res) => {
  try {
    const all = await DebitNote.find();
    res.json({
      success: true,
      data: {
        total:    all.length,
        pending:  all.filter(d => d.approvalStatus === 'Pending').length,
        approved: all.filter(d => d.approvalStatus === 'Approved').length,
        posted:   all.filter(d => d.approvalStatus === 'Posted').length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const create = async (req, res) => {
  try {
    const dnId = await genDNId();
    const dn = await DebitNote.create({
      ...req.body,
      dnId,
      createdBy: req.user?.name || 'System',
    });
    await dn.populate('vendorId');
    res.status(201).json({ success: true, data: dn });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const update = {
      approvalStatus: status,
      ...(status === 'Approved' ? { approvedBy: req.user?.name || 'System', approvalDate: new Date() } : {}),
    };
    const dn = await DebitNote.findByIdAndUpdate(req.params.id, update, { new: true }).populate('vendorId');
    if (!dn) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: dn });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const remove = async (req, res) => {
  try {
    await DebitNote.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
