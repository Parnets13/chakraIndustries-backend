import mongoose from 'mongoose';

// Track which notifications have been dismissed by which users
const dismissedNotificationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  notificationId: {
    type: String, // e.g., 'pr-123abc', 'po-456def'
    required: true,
  },
  dismissedAt: {
    type: Date,
    default: Date.now,
  },
}, { timestamps: true });

// Compound index: one user can only dismiss a notification once
dismissedNotificationSchema.index({ userId: 1, notificationId: 1 }, { unique: true });

export default mongoose.model('DismissedNotification', dismissedNotificationSchema);
