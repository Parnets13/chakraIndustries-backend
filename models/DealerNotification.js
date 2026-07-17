/**
 * DealerNotification.js
 * In-app notifications for the dealer app.
 * Created automatically when admin approves/rejects a return request.
 */
import mongoose from 'mongoose';

const dealerNotificationSchema = new mongoose.Schema({
  dealerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer', required: true, index: true },
  type:      { type: String, enum: ['return_approved', 'return_rejected', 'order', 'payment', 'general'], default: 'general' },
  title:     { type: String, required: true },
  message:   { type: String, required: true },
  refId:     { type: String, default: '' },   // mrId or orderId
  refModel:  { type: String, default: '' },   // 'MaterialReturn' | 'SalesOrder'
  read:      { type: Boolean, default: false },
}, { timestamps: true });

dealerNotificationSchema.index({ dealerId: 1, createdAt: -1 });

export default mongoose.model('DealerNotification', dealerNotificationSchema);
