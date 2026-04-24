import ActivityLog from '../models/ActivityLog.js';

/**
 * Helper to log any user action.
 * Call this from controllers after a successful operation.
 *
 * @param {Object} req        - Express request (for ip/userAgent)
 * @param {Object} user       - The acting user object
 * @param {string} action     - Action constant e.g. 'LOGIN'
 * @param {Object} [opts]     - Optional extra fields
 */
export const logActivity = async (req, user, action, opts = {}) => {
  try {
    await ActivityLog.create({
      user: user._id,
      userName: user.name,
      userRole: user.role,
      action,
      module: opts.module || 'auth',
      description: opts.description || '',
      targetId: opts.targetId || null,
      targetType: opts.targetType || null,
      ipAddress: req.ip || req.headers['x-forwarded-for'] || '',
      userAgent: req.headers['user-agent'] || '',
      status: opts.status || 'success',
      metadata: opts.metadata || null,
    });
  } catch (err) {
    // Never crash the main request because of logging failure
    console.error('ActivityLog error:', err.message);
  }
};
