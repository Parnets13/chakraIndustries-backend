import mongoose from 'mongoose';

const invoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  hsn:         { type: String, default: '' },
  qty:         { type: Number, required: true },
  unit:        { type: String, default: 'Nos' },
  rate:        { type: Number, required: true },
  discount:    { type: Number, default: 0 },       // percentage
  taxRate:     { type: Number, default: 18 },      // GST %
  amount:      { type: Number, required: true },   // qty * rate after discount
  taxAmount:   { type: Number, default: 0 },
  total:       { type: Number, required: true },   // amount + taxAmount
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceNo:    { type: String, unique: true, required: true },
  invoiceDate:  { type: Date, default: Date.now },
  dueDate:      { type: Date },

  // Billed To
  partyName:    { type: String, required: true },
  partyAddress: { type: String, default: '' },
  partyGST:     { type: String, default: '' },
  partyEmail:   { type: String, default: '' },
  partyPhone:   { type: String, default: '' },

  // Company (billed from)
  companyName:  { type: String, default: 'Chakra Industries' },
  companyAddress:{ type: String, default: '' },
  companyGST:   { type: String, default: '' },

  items:        [invoiceItemSchema],

  subtotal:     { type: Number, default: 0 },
  totalDiscount:{ type: Number, default: 0 },
  totalTax:     { type: Number, default: 0 },
  grandTotal:   { type: Number, default: 0 },

  notes:        { type: String, default: '' },
  terms:        { type: String, default: 'Payment due within 30 days.' },

  status: {
    type: String,
    enum: ['Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled'],
    default: 'Draft',
  },

  // Source tracking
  source:       { type: String, enum: ['manual', 'excel_upload'], default: 'manual' },
  uploadBatch:  { type: String, default: '' },  // batch ID for bulk uploads
}, { timestamps: true });

invoiceSchema.index({ invoiceNo: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ partyName: 1 });
invoiceSchema.index({ invoiceDate: -1 });

export default mongoose.model('Invoice', invoiceSchema);
