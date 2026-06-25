import PurchaseRequisition from '../models/PurchaseRequisition.js';
import { logActivity } from '../utils/activityLogger.js';

const generatePRId = async () => {
  const year = new Date().getFullYear();
  
  // Find the highest PR number for the current year
  const lastPR = await PurchaseRequisition.findOne(
    { prId: { $regex: `^PR-${year}-\\d{3}$` } },
    {},
    { sort: { prId: -1 } }
  );

  let nextNum = 1;
  if (lastPR) {
    const lastNum = parseInt(lastPR.prId.split('-')[2] || '0');
    nextNum = lastNum + 1;
  }

  return `PR-${year}-${String(nextNum).padStart(3, '0')}`;
};

const calcTotal = (items) =>
  items.reduce((s, i) => s + (parseFloat(i.qty) || 0) * (parseFloat(i.estimatedPrice) || 0), 0);

// POST /api/purchase-requisitions
export const createPurchaseRequisition = async (req, res) => {
  try {
    let pr;
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      try {
        const prId = await generatePRId();
        const totalValue = calcTotal(req.body.items || []);
        pr = await PurchaseRequisition.create({ ...req.body, prId, totalValue });
        break; // Success, exit loop
      } catch (err) {
        // Check if it's a duplicate key error
        if (err.code === 11000) {
          attempts++;
          if (attempts >= maxAttempts) {
            throw new Error('Failed to generate unique PR ID after multiple attempts');
          }
          // Retry with a new ID
          continue;
        }
        // If it's not a duplicate key error, rethrow
        throw err;
      }
    }

    if (req.user) {
      await logActivity(req, req.user, 'CREATE_PR', {
        module: 'procurement',
        description: `Created PR ${pr.prId} for ${pr.department}`,
        targetId: pr._id.toString(),
        targetType: 'PurchaseRequisition'
      });
    }

    res.status(201).json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// GET /api/purchase-requisitions
export const getAllPurchaseRequisitions = async (req, res) => {
  try {
    const { status, department, search, page, limit } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (department) filter.department = department;
    if (search) {
      filter.$or = [
        { prId:       { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } },
        { remarks:    { $regex: search, $options: 'i' } },
      ];
    }

    const pageNum  = parseInt(page)  || 0;
    const limitNum = parseInt(limit) || 0;
    const usePagination = pageNum > 0 && limitNum > 0;
    const skip = usePagination ? (pageNum - 1) * limitNum : 0;

    const [prs, totalCount] = await Promise.all([
      PurchaseRequisition.find(filter)
        .sort({ createdAt: -1 })
        .skip(usePagination ? skip : 0)
        .limit(usePagination ? limitNum : 0),
      usePagination ? PurchaseRequisition.countDocuments(filter) : Promise.resolve(null),
    ]);

    const response = { success: true, data: prs };
    if (usePagination) {
      response.pagination = {
        total: totalCount,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(totalCount / limitNum),
      };
    }
    res.json(response);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/purchase-requisitions/stats
export const getPRStats = async (req, res) => {
  try {
    const total = await PurchaseRequisition.countDocuments();
    const pending = await PurchaseRequisition.countDocuments({ status: 'Pending' });
    const approved = await PurchaseRequisition.countDocuments({ status: 'Approved' });
    const rejected = await PurchaseRequisition.countDocuments({ status: 'Rejected' });
    res.json({ success: true, data: { total, pending, approved, rejected } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// GET /api/purchase-requisitions/:id
export const getPurchaseRequisitionById = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findById(req.params.id);
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// PUT /api/purchase-requisitions/:id
export const updatePurchaseRequisition = async (req, res) => {
  try {
    if (req.body.items) req.body.totalValue = calcTotal(req.body.items);
    const pr = await PurchaseRequisition.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// PATCH /api/purchase-requisitions/:id/status
export const updatePRStatus = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    if (req.user) {
      await logActivity(req, req.user, 'UPDATE_PR_STATUS', {
        module: 'procurement',
        description: `PR ${pr.prId} status changed to ${pr.status}`,
        targetId: pr._id.toString(),
        targetType: 'PurchaseRequisition'
      });
    }
    res.json({ success: true, data: pr });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
};

// DELETE /api/purchase-requisitions/:id
export const deletePurchaseRequisition = async (req, res) => {
  try {
    const pr = await PurchaseRequisition.findByIdAndDelete(req.params.id);
    if (!pr) return res.status(404).json({ success: false, message: 'PR not found' });
    res.json({ success: true, message: 'PR deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
