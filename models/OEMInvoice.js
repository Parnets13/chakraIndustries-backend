import mongoose from 'mongoose';

const oemInvoiceSchema = new mongoose.Schema({
  invoiceNumber: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  oemBrand: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OEMBrand'
  },
  oemOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OEMOrder',
    required: true
  },
  brandOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BrandOrder',
    required: true
  },
  corporateClientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CorporateClient',
    required: true
  },
  invoiceDate: {
    type: Date,
    default: Date.now
  },
  dueDate: Date,
  product: String,
  quantity: Number,
  unit: String,
  unitPrice: Number,
  subtotal: Number,
  taxRate: {
    type: Number,
    default: 18
  },
  taxAmount: Number,
  totalAmount: {
    type: Number,
    required: true
  },
  paymentTerms: String,
  paymentStatus: {
    type: String,
    enum: ['Pending', 'Partial', 'Paid', 'Overdue'],
    default: 'Pending'
  },
  amountPaid: {
    type: Number,
    default: 0
  },
  paymentDate: Date,
  paymentMethod: String,
  paymentHistory: [{
    amount: Number,
    date: Date,
    method: String,
    reference: String,
    remarks: String
  }],
  notes: String,
  tallyDocumentId: String,
  tallyStatus: {
    type: String,
    enum: ['Pending', 'Synced', 'Failed'],
    default: 'Pending'
  },
  tallyError: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

oemInvoiceSchema.index({ invoiceNumber: 1 });
oemInvoiceSchema.index({ oemOrderId: 1 });
oemInvoiceSchema.index({ paymentStatus: 1 });
oemInvoiceSchema.index({ invoiceDate: -1 });

export default mongoose.model('OEMInvoice', oemInvoiceSchema);
