
import mongoose from 'mongoose';

const dealerReceiptSchema = new mongoose.Schema({
  dealer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dealer'
  },
  accountsReceivable: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccountsReceivable',
    required: true
  },
  receiptDate: {
    type: Date,
    default: Date.now
  },
  receiptAmount: {
    type: Number,
    required: true,
    default: 0
  },
  paymentMethod: {
    type: String,
    enum: ['Cash', 'Bank Transfer', 'Cheque', 'UPI', 'Other'],
    default: 'Other'
  },
  referenceNumber: {
    type: String
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

export default mongoose.model('DealerReceipt', dealerReceiptSchema);
