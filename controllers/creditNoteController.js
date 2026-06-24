import CreditNote from '../models/CreditNote.js';

const genCNId = async () => {
  const year = new Date().getFullYear();
  const prefix = `CN-${year}-`;
  const last = await CreditNote.findOne({ cnId: new RegExp(`^${prefix}`) }).sort({ cnId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.cnId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

const calcDaysOpen = (createdAt) =>
  Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60 * 24));

export const getAll = async (req, res) => {
  try {
    const { status, vendorId } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendorId) filter.vendorId = vendorId;
    const list = await CreditNote.find(filter)
      .populate('vendorId')
      .sort({ createdAt: -1 });
    const enriched = list.map(cn => ({
      ...cn.toObject(),
      daysOpen: calcDaysOpen(cn.createdAt),
    }));
    res.json({ success: true, data: enriched });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getStats = async (req, res) => {
  try {
    const all    = await CreditNote.find();
    const open   = all.filter(c => c.status === 'Open');
    const total  = open.reduce((s, c) => s + c.amount, 0);
    const overdue = open.filter(c => calcDaysOpen(c.createdAt) >= 7).length;
    res.json({ success: true, data: {
      openCount: open.length,
      totalValue: total,
      overdue,
      closed: all.filter(c => c.status === 'Closed').length,
    }});
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const create = async (req, res) => {
  try {
    const cnId = await genCNId();
    const cn = await CreditNote.create({ ...req.body, cnId });
    await cn.populate('vendorId');
    res.status(201).json({ success: true, data: cn });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const updateStatus = async (req, res) => {
  try {
    const cn = await CreditNote.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    ).populate('vendorId');
    if (!cn) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: cn });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const sendReminder = async (req, res) => {
  try {
    const cn = await CreditNote.findByIdAndUpdate(
      req.params.id,
      { reminderSentAt: new Date() },
      { new: true }
    ).populate('vendorId');
    if (!cn) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, message: `Reminder logged for ${cn.cnId}`, data: cn });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const remove = async (req, res) => {
  try {
    await CreditNote.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
