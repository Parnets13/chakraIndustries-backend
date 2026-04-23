import mongoose from 'mongoose';

const creditNoteSchema = new mongoose.Schema({
  cnId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  poId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder'
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  reason: {
    type: String,
    enum: ['Quality Issue', 'Price Adjustment', 'Defective Goods', 'Partial Return', 'Overcharge', 'Other'],
    required: true
  },
  description: String,
  status: {
    type: String,
    enum: ['Draft', 'Pending', 'Approved', 'Overdue', 'Paid', 'Cancelled'],
    default: 'Draft'
  },
  issuedDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date,
    required: true
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  reminderSent: {
    type: Boolean,
    default: false
  },
  reminderSentDate: Date,
  nextReminderDate: Date,
  remarks: String
}, {
  timestamps: true
});

// Index for finding overdue notes
creditNoteSchema.index({ dueDate: 1, status: 1 });
creditNoteSchema.index({ vendor: 1, status: 1 });

export default mongoose.model('CreditNote', creditNoteSchema);
