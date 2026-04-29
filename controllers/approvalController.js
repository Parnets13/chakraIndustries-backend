import Approval from '../models/Approval.js';
import GRN from '../models/GRN.js';
import PurchaseOrder from '../models/PurchaseOrder.js';

// GET all approvals
export const getAllApprovals = async (req, res) => {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;
    const approvals = await Approval.find(filter)
      .populate('grnId', 'grnId receivedQuantity orderedQuantity')
      .populate('poId', 'poId grandTotal')
      .populate('vendorId', 'companyName vendorId')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: approvals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET stats
export const getApprovalStats = async (req, res) => {
  try {
    const pending  = await Approval.countDocuments({ status: 'Pending' });
    const approved = await Approval.countDocuments({ status: 'Approved' });
    const rejected = await Approval.countDocuments({ status: 'Rejected' });
    res.json({ success: true, data: { pending, approved, rejected, total: pending + approved + rejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PATCH approve
export const approveApproval = async (req, res) => {
  try {
    const { approvedBy, remarks } = req.body;
    const approval = await Approval.findByIdAndUpdate(
      req.params.id,
      { status: 'Approved', approvedBy: approvedBy || 'Admin', approvedAt: new Date(), remarks: remarks || '' },
      { new: true }
    ).populate('grnId', 'grnId').populate('poId', 'poId').populate('vendorId', 'companyName');

    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found' });

    // Update GRN approvalStatus
    if (approval.grnId) {
      await GRN.findByIdAndUpdate(approval.grnId._id || approval.grnId, { approvalStatus: 'Approved' });
    }
    // Update PO status to Received
    if (approval.poId) {
      await PurchaseOrder.findByIdAndUpdate(approval.poId._id || approval.poId, { status: 'Received' });
    }

    res.json({ success: true, data: approval });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH reject
export const rejectApproval = async (req, res) => {
  try {
    const { approvedBy, remarks } = req.body;
    const approval = await Approval.findByIdAndUpdate(
      req.params.id,
      { status: 'Rejected', approvedBy: approvedBy || 'Admin', approvedAt: new Date(), remarks: remarks || '' },
      { new: true }
    ).populate('grnId', 'grnId').populate('poId', 'poId').populate('vendorId', 'companyName');

    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found' });

    if (approval.grnId) {
      await GRN.findByIdAndUpdate(approval.grnId._id || approval.grnId, { approvalStatus: 'Rejected' });
    }

    res.json({ success: true, data: approval });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};
