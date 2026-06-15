
import mongoose from 'mongoose';

const supplierPaymentSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  accountsPayable: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'AccountsPayable',
    required: true
  },
  paymentDate: {
    type: Date,
    default: Date.now
  },
  paymentAmount: {
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

export default mongoose.model('SupplierPayment', supplierPaymentSchema);
