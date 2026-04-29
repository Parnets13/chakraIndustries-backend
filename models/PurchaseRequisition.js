import mongoose from 'mongoose';

const prItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  qty: { type: Number, required: true },
  unit: { type: String, default: 'Nos' },
  estimatedPrice: { type: Number, default: 0 },
}, { _id: false });

const purchaseRequisitionSchema = new mongoose.Schema({
  prId: { type: String, unique: true, required: true },
  department: {
    type: String,
    required: true,
  },
  requestedBy: { type: String, required: true },
  requiredBy: { type: Date },
  priority: { type: String, enum: ['Normal', 'Urgent', 'Critical'], default: 'Normal' },
  costCenter: String,
  remarks: String,
  items: [prItemSchema],
  totalValue: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending',
  },
}, { timestamps: true });

export default mongoose.model('PurchaseRequisition', purchaseRequisitionSchema);
