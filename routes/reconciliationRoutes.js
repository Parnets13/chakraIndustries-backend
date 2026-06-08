/**
 * /api/reconciliation — returns material-return records that are in
 * Finance_Reconciliation stage or have a reconciliationStatus set.
 * Delegates to materialReturnController for data.
 */
import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import MaterialReturn from '../models/MaterialReturn.js';

const router = express.Router();
router.use(protect);

// GET /api/reconciliation — all records relevant to reconciliation
router.get('/', async (req, res) => {
  try {
    const records = await MaterialReturn.find({
      $or: [
        { stage: { $in: ['Finance_Reconciliation', 'Tally_Sync', 'Closed', 'QC_Completed'] } },
        { reconciliationStatus: { $in: ['In Progress', 'Completed'] } },
        { creditNoteNo: { $ne: '' } },
        { debitNoteNo: { $ne: '' } },
      ],
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/reconciliation/stats
router.get('/stats', async (req, res) => {
  try {
    const all = await MaterialReturn.find();
    const matched   = all.filter(r => r.reconciliationStatus === 'Completed').length;
    const pending   = all.filter(r => r.reconciliationStatus === 'Pending').length;
    const inProgress = all.filter(r => r.reconciliationStatus === 'In Progress').length;
    const totalLoss = all.reduce((s, r) => s + (r.lossAmount || 0), 0);
    res.json({ success: true, data: { matched, pending, inProgress, totalLoss } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/reconciliation/:id — update reconciliation fields on a material return
router.patch('/:id', async (req, res) => {
  try {
    const { creditNoteNo, debitNoteNo, reconciliationStatus, ledgerStatus } = req.body;
    const update = {};
    if (creditNoteNo !== undefined)        update.creditNoteNo = creditNoteNo;
    if (debitNoteNo !== undefined)         update.debitNoteNo = debitNoteNo;
    if (reconciliationStatus !== undefined) update.reconciliationStatus = reconciliationStatus;
    if (ledgerStatus !== undefined)        update.ledgerStatus = ledgerStatus;

    const record = await MaterialReturn.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

export default router;
