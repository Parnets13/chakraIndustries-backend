
import mongoose from 'mongoose';

const accountsPayableSchema = new mongoose.Schema({
  supplier: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  purchaseOrder: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder'
  },
  poInvoice: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'POInvoice'
  },
  invoiceNumber: {
    type: String,
    required: true,
    unique: true
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

accountsPayableSchema.pre('save', function(next) {
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

export default mongoose.model('AccountsPayable', accountsPayableSchema);
