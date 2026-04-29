import mongoose from 'mongoose';

const grnSchema = new mongoose.Schema({
  grnId: {
    type: String,
    unique: true,
    required: true
  },
  poId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder',
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  orderedQuantity: {
    type: Number,
    required: true
  },
  receivedQuantity: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['Completed', 'Partial', 'Pending'],
    default: 'Pending'
  },
  receivedDate: {
    type: Date,
    default: Date.now
  },
  items: [{
    name:     { type: String },
    orderedQty:  { type: Number },
    receivedQty: { type: Number },
    unit:     { type: String },
  }],
  remarks: String,
  qcStatus: {
    type: String,
    enum: ['Not Started', 'Pending', 'Passed', 'Partial', 'Rejected'],
    default: 'Not Started',
  },
  approvalStatus: {
    type: String,
    enum: ['Not Required', 'Pending', 'Approved', 'Rejected'],
    default: 'Not Required',
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

export default mongoose.model('GRN', grnSchema);
