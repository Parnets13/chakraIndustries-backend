import mongoose from 'mongoose';

const creditNoteItemSchema = new mongoose.Schema({
  productName: { type: String, default: '' },
  quantity:    { type: Number, default: 1 },
  rate:        { type: Number, default: 0 },
  amount:      { type: Number, default: 0 },
  gstRate:     { type: Number, default: 18 },
}, { _id: false });

const creditNoteSchema = new mongoose.Schema({
  cnId:       { type: String, unique: true, required: true },
  vendorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  vendorName: { type: String, required: true },
  vendorEmail: { type: String, default: '' },
  vendorGST:  { type: String, default: '' },
  vendorAddress: { type: String, default: '' },
  against:    { type: String, default: '' },   // MR ID or return ref or invoice number
  grnId:      { type: String, default: '' },
  poId:       { type: String, default: '' },
  invoiceNumber: { type: String, default: '' },
  amount:     { type: Number, required: true },
  reason:     { type: String, default: '' },
  items: [creditNoteItemSchema],
  status: {
    type: String,
    enum: ['Open', 'Closed', 'Disputed'],
    default: 'Open',
  },
  daysOpen:   { type: Number, default: 0 },
  reminderSentAt: { type: Date },
}, { timestamps: true });

export default mongoose.model('CreditNote', creditNoteSchema);
