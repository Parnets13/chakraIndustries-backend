import mongoose from 'mongoose';

const approvalSchema = new mongoose.Schema({
  approvalId:   { type: String, unique: true, required: true },
  docType:      { type: String, enum: ['GRN', 'QC', 'PO', 'PR'], required: true },
  docRef:       { type: String, required: true },          // human-readable ID e.g. GRN-2026-001
  docId:        { type: mongoose.Schema.Types.ObjectId },  // MongoDB _id of the source doc
  grnId:        { type: mongoose.Schema.Types.ObjectId, ref: 'GRN' },
  poId:         { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  vendorId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  amount:       { type: Number, default: 0 },
  requestedBy:  { type: String, default: '' },
  department:   { type: String, default: 'Procurement' },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
  },
  approvedBy:   { type: String, default: '' },
  approvedAt:   { type: Date },
  remarks:      { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('Approval', approvalSchema);
