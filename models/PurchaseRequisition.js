import mongoose from 'mongoose';

const purchaseRequisitionSchema = new mongoose.Schema({
  prId: {
    type: String,
    unique: true,
    required: true
  },
  department: {
    type: String,
    enum: ['Production', 'Maintenance', 'Admin'],
    required: true
  },
  requestedBy: {
    type: String,
    required: true
  },
  requiredBy: {
    type: Date,
    required: true
  },
  priority: {
    type: String,
    enum: ['Normal', 'Urgent', 'Critical'],
    default: 'Normal'
  },
  items: {
    type: Number,
    required: true
  },
  value: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  remarks: String,
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('PurchaseRequisition', purchaseRequisitionSchema);
