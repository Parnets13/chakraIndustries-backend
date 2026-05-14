import BulkOrderApproval from '../models/BulkOrderApproval.js';
import BulkQuotation from '../models/BulkQuotation.js';
import CorporateClient from '../models/CorporateClient.js';

const generateApprovalId = async () => {
  const last = await BulkOrderApproval.findOne({}, {}, { sort: { createdAt: -1 } });
  if (!last) return 'APPR-2024-001';
  const num = parseInt(last.approvalId.split('-')[2] || '0') + 1;
  return `APPR-2024-${String(num).padStart(3, '0')}`;
};

// Get approval rules based on order value and client tier
const getApprovalRules = (orderValue, clientTier) => {
  const rules = {
    Silver: [
      { level: 1, role: 'Sales Manager', threshold: 0 }
    ],
    Gold: [
      { level: 1, role: 'Sales Manager', threshold: 0 },
      { level: 2, role: 'Finance Manager', threshold: 500000 }
    ],
    Platinum: [
      { level: 1, role: 'Sales Manager', threshold: 0 },
      { level: 2, role: 'Finance Manager', threshold: 500000 },
      { level: 3, role: 'Director', threshold: 1000000 }
    ]
  };

  const tierRules = rules[clientTier] || rules.Silver;
  return tierRules.filter(r => orderValue >= r.threshold);
};

export const createApprovalWorkflow = async (req, res) => {
  try {
    const { quotationId, clientId, orderValue } = req.body;

    // Get client tier
    const client = await CorporateClient.findOne({ clientId });
    if (!client) return res.status(404).json({ success: false, message: 'Client not found' });

    // Get approval rules
    const approvalRules = getApprovalRules(orderValue, client.tier);

    // Create approval chain
    const approvalChain = approvalRules.map(rule => ({
      level: rule.level,
      role: rule.role,
      status: 'Pending'
    }));

    const approvalId = await generateApprovalId();
    const approval = await BulkOrderApproval.create({
      approvalId,
      quotationId,
      clientId,
      orderValue,
      approvalChain,
      createdBy: req.user?._id
    });

    res.status(201).json({ success: true, data: approval });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getApprovalById = async (req, res) => {
  try {
    const approval = await BulkOrderApproval.findById(req.params.id)
      .populate('approvalChain.approver', 'name email role');
    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found' });
    res.json({ success: true, data: approval });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getPendingApprovals = async (req, res) => {
  try {
    const { role } = req.query;
    const filter = { overallStatus: 'Pending' };
    if (role) {
      filter['approvalChain.role'] = role;
      filter['approvalChain.status'] = 'Pending';
    }
    const approvals = await BulkOrderApproval.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: approvals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const approveAtLevel = async (req, res) => {
  try {
    const { remarks } = req.body;
    const approval = await BulkOrderApproval.findById(req.params.id);
    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found' });

    // Find current pending level
    const currentLevelApproval = approval.approvalChain.find(a => a.status === 'Pending');
    if (!currentLevelApproval) {
      return res.status(400).json({ success: false, message: 'No pending approval level' });
    }

    // Update current level
    currentLevelApproval.status = 'Approved';
    currentLevelApproval.remarks = remarks;
    currentLevelApproval.approver = req.user?._id;
    currentLevelApproval.approvedAt = new Date();

    // Check if all levels approved
    const allApproved = approval.approvalChain.every(a => a.status === 'Approved');
    if (allApproved) {
      approval.overallStatus = 'Approved';
      approval.currentLevel = approval.approvalChain.length;

      // Update quotation status
      await BulkQuotation.findOneAndUpdate(
        { quotationId: approval.quotationId },
        { status: 'Approved' }
      );
    } else {
      approval.currentLevel += 1;
    }

    await approval.save();
    res.json({ success: true, data: approval, message: 'Approval recorded' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const rejectApproval = async (req, res) => {
  try {
    const { rejectionReason } = req.body;
    const approval = await BulkOrderApproval.findById(req.params.id);
    if (!approval) return res.status(404).json({ success: false, message: 'Approval not found' });

    approval.overallStatus = 'Rejected';
    approval.rejectionReason = rejectionReason;

    // Update quotation status
    await BulkQuotation.findOneAndUpdate(
      { quotationId: approval.quotationId },
      { status: 'Rejected' }
    );

    await approval.save();
    res.json({ success: true, data: approval, message: 'Approval rejected' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

export const getApprovalStats = async (req, res) => {
  try {
    const pending = await BulkOrderApproval.countDocuments({ overallStatus: 'Pending' });
    const approved = await BulkOrderApproval.countDocuments({ overallStatus: 'Approved' });
    const rejected = await BulkOrderApproval.countDocuments({ overallStatus: 'Rejected' });

    res.json({ success: true, data: { pending, approved, rejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
