import mongoose from 'mongoose';

const BankReconciliationSchema = new mongoose.Schema({
  statementId: {
    type: String,
    unique: true,
    default: function () {
      return 'BRS-' + Date.now();
    },
  },
  fileName: { type: String, required: true },
  filePath: { type: String },
  fileType: { type: String },
  bankName: { type: String },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['Pending', 'Processing', 'Reconciled', 'Error'], default: 'Pending' },
  transactions: [{ type: mongoose.Schema.Types.Mixed }],
  matchedEntries: [{ type: mongoose.Schema.Types.ObjectId, ref: 'TallyVoucher' }],
  unmatchedEntries: [{ type: mongoose.Schema.Types.Mixed }],
  notes: { type: String },
}, { timestamps: true });

export default mongoose.model('BankReconciliation', BankReconciliationSchema);
