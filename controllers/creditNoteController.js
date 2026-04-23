import CreditNote from '../models/CreditNote.js';
import Vendor from '../models/Vendor.js';

// Generate Credit Note ID
const generateCNId = async () => {
  const year = new Date().getFullYear();
  const lastCN = await CreditNote.findOne({ cnId: new RegExp(`^CN-${year}-`) })
    .sort({ cnId: -1 })
    .limit(1);
  
  if (!lastCN) return `CN-${year}-001`;
  
  const lastNum = parseInt(lastCN.cnId.split('-')[2]);
  const newNum = String(lastNum + 1).padStart(3, '0');
  return `CN-${year}-${newNum}`;
};

// CREATE Credit Note
export const createCreditNote = async (req, res) => {
  try {
    const cnId = await generateCNId();
    const creditNote = new CreditNote({
      ...req.body,
      cnId
    });
    await creditNote.save();
    await creditNote.populate('vendor', 'companyName');
    res.status(201).json({ success: true, data: creditNote });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET ALL Credit Notes
export const getAllCreditNotes = async (req, res) => {
  try {
    const { status, vendor, priority } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (vendor) filter.vendor = vendor;
    if (priority) filter.priority = priority;

    const creditNotes = await CreditNote.find(filter)
      .populate('vendor', 'companyName email phone')
      .populate('poId', 'poId')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: creditNotes });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET Credit Note by ID
export const getCreditNoteById = async (req, res) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id)
      .populate('vendor')
      .populate('poId');

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    res.json({ success: true, data: creditNote });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// UPDATE Credit Note
export const updateCreditNote = async (req, res) => {
  try {
    const creditNote = await CreditNote.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate('vendor', 'companyName');

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    res.json({ success: true, data: creditNote });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// UPDATE Credit Note Status
export const updateCreditNoteStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const creditNote = await CreditNote.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true, runValidators: true }
    ).populate('vendor', 'companyName');

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    res.json({ success: true, data: creditNote });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// SEND REMINDER
export const sendReminder = async (req, res) => {
  try {
    const creditNote = await CreditNote.findById(req.params.id)
      .populate('vendor', 'email companyName');

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    // Calculate next reminder date (7 days from now)
    const nextReminderDate = new Date();
    nextReminderDate.setDate(nextReminderDate.getDate() + 7);

    // Update reminder status
    creditNote.reminderSent = true;
    creditNote.reminderSentDate = new Date();
    creditNote.nextReminderDate = nextReminderDate;
    await creditNote.save();

    // TODO: Integrate with email service to send actual reminder
    // For now, just log it
    console.log(`📧 Reminder sent to ${creditNote.vendor.email} for CN ${creditNote.cnId}`);

    res.json({ 
      success: true, 
      message: 'Reminder sent successfully',
      data: creditNote 
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET OVERDUE Credit Notes
export const getOverdueCreditNotes = async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdueCNs = await CreditNote.find({
      dueDate: { $lt: today },
      status: { $nin: ['Paid', 'Cancelled'] }
    })
      .populate('vendor', 'companyName email phone')
      .sort({ dueDate: 1 });

    res.json({ success: true, data: overdueCNs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET CREDIT NOTE STATS
export const getCreditNoteStats = async (req, res) => {
  try {
    const total = await CreditNote.countDocuments();
    const pending = await CreditNote.countDocuments({ status: 'Pending' });
    const overdue = await CreditNote.countDocuments({ 
      dueDate: { $lt: new Date() },
      status: { $nin: ['Paid', 'Cancelled'] }
    });
    const paid = await CreditNote.countDocuments({ status: 'Paid' });
    const totalAmount = await CreditNote.aggregate([
      { $match: { status: { $nin: ['Cancelled'] } } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);

    res.json({ 
      success: true, 
      data: { 
        total, 
        pending, 
        overdue, 
        paid,
        totalAmount: totalAmount[0]?.total || 0
      } 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE Credit Note
export const deleteCreditNote = async (req, res) => {
  try {
    const creditNote = await CreditNote.findByIdAndDelete(req.params.id);

    if (!creditNote) {
      return res.status(404).json({ success: false, message: 'Credit note not found' });
    }

    res.json({ success: true, message: 'Credit note deleted successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
