import QualityCheck from '../models/QualityCheck.js';
import GRN from '../models/GRN.js';
import Approval from '../models/Approval.js';
import { updateInventoryFromQC } from './inventoryController.js';

const generateQCId = async () => {
  const year = new Date().getFullYear();
  const prefix = `QC-${year}-`;
  const last = await QualityCheck.findOne({ qcId: new RegExp(`^${prefix}`) }).sort({ qcId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.qcId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

const generateApprovalId = async () => {
  const year = new Date().getFullYear();
  const prefix = `APR-${year}-`;
  const last = await Approval.findOne({ approvalId: new RegExp(`^${prefix}`) }).sort({ approvalId: -1 });
  if (!last) return `${prefix}001`;
  const num = parseInt(last.approvalId.split('-')[2]) || 0;
  return `${prefix}${String(num + 1).padStart(3, '0')}`;
};

// GET all QC records
export const getAllQC = async (req, res) => {
  try {
    const qcs = await QualityCheck.find()
      .populate('grnId', 'grnId receivedQuantity orderedQuantity')
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: qcs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET stats
export const getQCStats = async (req, res) => {
  try {
    const total    = await QualityCheck.countDocuments();
    const passed   = await QualityCheck.countDocuments({ status: 'Passed' });
    const partial  = await QualityCheck.countDocuments({ status: 'Partial' });
    const pending  = await QualityCheck.countDocuments({ status: 'Pending' });
    const rejected = await QualityCheck.countDocuments({ status: 'Rejected' });
    res.json({ success: true, data: { total, passed, partial, pending, rejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET one
export const getQCById = async (req, res) => {
  try {
    const qc = await QualityCheck.findById(req.params.id)
      .populate('grnId', 'grnId receivedQuantity orderedQuantity items')
      .populate('poId', 'poId grandTotal items')
      .populate('vendorId', 'companyName vendorId');
    if (!qc) return res.status(404).json({ success: false, message: 'QC not found' });
    res.json({ success: true, data: qc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// POST submit QC result (pass/fail items)
export const submitQC = async (req, res) => {
  try {
    const { id } = req.params;
    const { items, inspectedBy, remarks } = req.body;

    const qc = await QualityCheck.findById(id);
    if (!qc) return res.status(404).json({ success: false, message: 'QC not found' });

    const totalFailed = items.reduce((s, i) => s + (i.failedQty || 0), 0);
    const totalPassed = items.reduce((s, i) => s + (i.passedQty || 0), 0);
    const newStatus = totalFailed === 0 ? 'Passed' : totalPassed === 0 ? 'Rejected' : 'Partial';

    qc.items = items;
    qc.status = newStatus;
    qc.inspectedBy = inspectedBy || '';
    qc.inspectedAt = new Date();
    qc.remarks = remarks || '';
    await qc.save();

    // Get GRN to extract warehouse info
    const grn = await GRN.findById(qc.grnId);
    if (!grn) return res.status(404).json({ success: false, message: 'GRN not found' });

    // Update GRN qcStatus — must match GRN model enum: 'Not Started','Pending','Passed','Partial','Rejected'
    const grnQcStatus = newStatus === 'Passed' ? 'Passed' : newStatus === 'Partial' ? 'Partial' : 'Rejected';
    await GRN.findByIdAndUpdate(qc.grnId, { qcStatus: grnQcStatus });

    console.log(`[QC SUBMIT] QC ${qc.qcId} submitted with status: ${newStatus}`);

    // If passed or partial → update inventory with passed qty
    if (newStatus === 'Passed' || newStatus === 'Partial') {
      console.log(`[QC SUBMIT] Triggering inventory update for GRN: ${grn.grnId}`);
      await updateInventoryFromQC({
        items: qc.items,
        grnId: qc.grnId,
        poId: qc.poId,
        vendorId: qc.vendorId,
        warehouseId: grn.warehouseId,
      });

      // Auto-create Approval record
      const existingApproval = await Approval.findOne({ grnId: qc.grnId });
      if (!existingApproval) {
        const approvalId = await generateApprovalId();
        const poData = await GRN.findById(qc.grnId).populate('poId', 'grandTotal').populate('vendorId', 'companyName');
        await Approval.create({
          approvalId,
          docType: 'GRN',
          docRef: grn?.grnId || '',
          docId: qc.grnId,
          grnId: qc.grnId,
          poId: qc.poId,
          vendorId: qc.vendorId,
          amount: poData?.poId?.grandTotal || 0,
          requestedBy: inspectedBy || 'QC Inspector',
          department: 'Procurement',
          status: 'Pending',
        });
        await GRN.findByIdAndUpdate(qc.grnId, { approvalStatus: 'Pending' });
      }

      // Update GRN status to Inventory_Updated
      await GRN.findByIdAndUpdate(qc.grnId, { grnStatus: 'Inventory_Updated' });
      console.log(`[QC SUBMIT] ✅ GRN ${grn.grnId} status updated to Inventory_Updated`);
    }

    const populated = await QualityCheck.findById(id)
      .populate('grnId', 'grnId')
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName');

    res.json({ success: true, data: populated });
  } catch (err) {
    console.error('[QC SUBMIT] ❌ Error in submitQC:', err);
    res.status(400).json({ success: false, message: err.message });
  }
};
