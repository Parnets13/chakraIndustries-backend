import mongoose from 'mongoose';

const debitNoteItemSchema = new mongoose.Schema({
  productName: { type: String, default: '' },
  quantity:    { type: Number, default: 1 },
  rate:        { type: Number, default: 0 },
  amount:      { type: Number, default: 0 },
  gstRate:     { type: Number, default: 18 },
}, { _id: false });

const debitNoteSchema = new mongoose.Schema({
  dnId:           { type: String, unique: true, required: true },
  vendorId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  vendorName:     { type: String, required: true },
  vendorEmail:    { type: String, default: '' },
  vendorGST:      { type: String, default: '' },
  vendorAddress:  { type: String, default: '' },
  grnId:          { type: String, default: '' },
  poId:           { type: String, default: '' },
  invoiceNumber:  { type: String, default: '' },
  mrId:           { type: String, default: '' },   // linked material return
  debitAmount:    { type: Number, default: 0 },
  gstAmount:      { type: Number, default: 0 },
  totalAmount:    { type: Number, default: 0 },
  recoveryAmount: { type: Number, default: 0 },
  taxReversal:    { type: Number, default: 0 },
  reason:         { type: String, required: true },
  damageType: {
    type: String,
    enum: ['Quality Rejection', 'Damage in Transit', 'Wrong Item', 'Quantity Shortage', 'Expired Product'],
    default: 'Quality Rejection',
  },
  approvalStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Posted'],
    default: 'Pending',
  },
  items: [debitNoteItemSchema],
  attachments: [{ type: String }],
  createdBy: { type: String, default: '' },
  approvedBy: { type: String, default: '' },
  approvalDate: { type: Date },
  remarks: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('DebitNote', debitNoteSchema);
