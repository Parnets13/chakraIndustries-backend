import mongoose from 'mongoose';

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    userName: { type: String }, // snapshot at time of action
    userRole: { type: String },
    action: {
      type: String,
      required: true,
      // e.g. LOGIN, LOGOUT, CREATE_USER, UPDATE_USER, DELETE_USER,
      //      CHANGE_PASSWORD, UPDATE_PERMISSION, etc.
    },
    module: {
      type: String,
      default: 'auth',
      // auth | users | permissions | procurement | inventory | ...
    },
    description: { type: String },
    targetId: { type: String },   // id of the affected resource
    targetType: { type: String }, // User | Vendor | PO | PR | ...
    ipAddress: { type: String },
    userAgent: { type: String },
    status: {
      type: String,
      enum: ['success', 'failure'],
      default: 'success',
    },
    metadata: { type: mongoose.Schema.Types.Mixed }, // extra payload
  },
  { timestamps: true }
);

// Index for fast queries
activityLogSchema.index({ user: 1, createdAt: -1 });
activityLogSchema.index({ action: 1 });
activityLogSchema.index({ module: 1 });
activityLogSchema.index({ createdAt: -1 });

export default mongoose.model('ActivityLog', activityLogSchema);
