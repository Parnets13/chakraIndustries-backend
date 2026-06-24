
import mongoose from 'mongoose';

const accountsReceivableSchema = new mongoose.Schema({
  dealer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Dealer'
  },
  salesOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesOrder'
  },
  invoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    required: true
  },
  invoiceNumber: {
    type: String,
    required: true
  },
  invoiceDate: {
    type: Date,
    default: Date.now
  },
  dueDate: {
    type: Date
  },
  invoiceAmount: {
    type: Number,
    required: true,
    default: 0
  },
  paidAmount: {
    type: Number,
    required: true,
    default: 0
  },
  balanceAmount: {
    type: Number,
    required: true,
    default: 0
  },
  paymentStatus: {
    type: String,
    enum: ['Unpaid', 'Partially Paid', 'Paid'],
    default: 'Unpaid'
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

accountsReceivableSchema.pre('save', function(next) {
  if (this.isModified('invoiceAmount') || this.isModified('paidAmount')) {
    this.balanceAmount = Math.max(0, this.invoiceAmount - this.paidAmount);
    if (this.paidAmount <= 0) {
      this.paymentStatus = 'Unpaid';
    } else if (this.paidAmount >= this.invoiceAmount) {
      this.paymentStatus = 'Paid';
    } else {
      this.paymentStatus = 'Partially Paid';
    }
  }
  next();
});

export default mongoose.model('AccountsReceivable', accountsReceivableSchema);
