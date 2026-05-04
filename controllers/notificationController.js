import PurchaseRequisition from '../models/PurchaseRequisition.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import GRN from '../models/GRN.js';
import Approval from '../models/Approval.js';
import ActivityLog from '../models/ActivityLog.js';

// GET /api/notifications
// Returns live notifications aggregated from all procurement modules
export const getNotifications = async (req, res) => {
  try {
    const notifications = [];

    // ── Pending PRs awaiting approval ──
    const pendingPRs = await PurchaseRequisition.find({ status: 'Pending' })
      .sort({ createdAt: -1 }).limit(5).select('prId department requestedBy createdAt priority');
    pendingPRs.forEach(pr => {
      notifications.push({
        id: `pr-${pr._id}`,
        type: pr.priority === 'Critical' ? 'danger' : pr.priority === 'Urgent' ? 'warning' : 'info',
        text: `PR ${pr.prId} from ${pr.department} awaiting approval`,
        subtext: `Requested by ${pr.requestedBy}`,
        time: pr.createdAt,
        module: 'PR',
        link: '/procurement/pr',
      });
    });

    // ── POs pending approval ──
    const pendingPOs = await PurchaseOrder.find({ status: 'Pending' })
      .populate('vendor', 'companyName')
      .sort({ createdAt: -1 }).limit(5).select('poId vendor grandTotal createdAt');
    pendingPOs.forEach(po => {
      notifications.push({
        id: `po-${po._id}`,
        type: 'warning',
        text: `PO ${po.poId} awaiting approval`,
        subtext: `${po.vendor?.companyName || 'Unknown vendor'} · ₹${Math.round(po.grandTotal || 0).toLocaleString('en-IN')}`,
        time: po.createdAt,
        module: 'PO',
        link: '/procurement/po',
      });
    });

    // ── GRNs with pending QC ──
    const pendingQC = await GRN.find({ qcStatus: 'Pending' })
      .populate('vendorId', 'companyName')
      .sort({ createdAt: -1 }).limit(5).select('grnId vendorId receivedQuantity createdAt');
    pendingQC.forEach(grn => {
      notifications.push({
        id: `grn-${grn._id}`,
        type: 'info',
        text: `GRN ${grn.grnId} pending quality check`,
        subtext: `${grn.vendorId?.companyName || 'Unknown vendor'} · ${grn.receivedQuantity} units`,
        time: grn.createdAt,
        module: 'GRN',
        link: '/procurement/qc',
      });
    });

    // ── Pending approvals ──
    const pendingApprovals = await Approval.find({ status: 'Pending' })
      .populate('vendorId', 'companyName')
      .sort({ createdAt: -1 }).limit(5).select('approvalId docRef docType amount vendorId createdAt');
    pendingApprovals.forEach(a => {
      notifications.push({
        id: `apr-${a._id}`,
        type: 'warning',
        text: `${a.docType} approval pending: ${a.docRef}`,
        subtext: `${a.vendorId?.companyName || ''} · ₹${Math.round(a.amount || 0).toLocaleString('en-IN')}`,
        time: a.createdAt,
        module: 'Approval',
        link: '/procurement/approvals',
      });
    });

    // ── Recent activity (last 5 actions in past 24h) ──
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActivity = await ActivityLog.find({ createdAt: { $gte: since }, status: 'success' })
      .sort({ createdAt: -1 }).limit(5).select('action description userName module createdAt');
    recentActivity.forEach(log => {
      notifications.push({
        id: `log-${log._id}`,
        type: 'success',
        text: log.description || log.action,
        subtext: `By ${log.userName || 'System'} · ${log.module}`,
        time: log.createdAt,
        module: log.module,
        link: null,
      });
    });

    // Sort all by time descending, cap at 20
    notifications.sort((a, b) => new Date(b.time) - new Date(a.time));
    const result = notifications.slice(0, 20);

    // Unread count = pending items (PRs + POs + GRNs + Approvals)
    const unreadCount = pendingPRs.length + pendingPOs.length + pendingQC.length + pendingApprovals.length;

    res.json({ success: true, data: result, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
