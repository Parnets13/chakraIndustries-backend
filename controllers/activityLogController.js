import ActivityLog from '../models/ActivityLog.js';

// GET /api/activity-logs
// Query params: userId, action, module, status, startDate, endDate, page, limit
export const getActivityLogs = async (req, res) => {
  try {
    const {
      userId, action, module, status,
      startDate, endDate,
      page = 1, limit = 50,
    } = req.query;

    const filter = {};
    if (userId)    filter.user = userId;
    if (action)    filter.action = { $regex: action, $options: 'i' };
    if (module)    filter.module = module;
    if (status)    filter.status = status;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate)   filter.createdAt.$lte = new Date(endDate);
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [logs, total] = await Promise.all([
      ActivityLog.find(filter)
        .populate('user', 'name email role avatar')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ActivityLog.countDocuments(filter),
    ]);

    res.json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      logs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/activity-logs/my  — own logs (any authenticated user)
export const getMyActivityLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [logs, total] = await Promise.all([
      ActivityLog.find({ user: req.user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ActivityLog.countDocuments({ user: req.user._id }),
    ]);

    res.json({
      success: true,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      logs,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/activity-logs/stats  — summary counts per action/module
export const getActivityStats = async (req, res) => {
  try {
    const [byAction, byModule, byStatus] = await Promise.all([
      ActivityLog.aggregate([
        { $group: { _id: '$action', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 20 },
      ]),
      ActivityLog.aggregate([
        { $group: { _id: '$module', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ]),
      ActivityLog.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({ success: true, byAction, byModule, byStatus });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// DELETE /api/activity-logs/purge  — super_admin only — delete logs older than N days
export const purgeLogs = async (req, res) => {
  try {
    const { days = 90 } = req.body;
    const cutoff = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000);
    const result = await ActivityLog.deleteMany({ createdAt: { $lt: cutoff } });
    res.json({ success: true, deleted: result.deletedCount, message: `Purged logs older than ${days} days` });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
