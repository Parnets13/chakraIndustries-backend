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
  warehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true
  },
  batchNo: {
    type: String,
    default: null
  },
  mfgDate: Date,
  expiryDate: Date,
  orderedQuantity: {
    type: Number,
    required: true
  },
  receivedQuantity: {
    type: Number,
    required: true
  },
  acceptedQuantity: {
    type: Number,
    default: 0
  },
  rejectedQuantity: {
    type: Number,
    default: 0
  },
  grnStatus: {
    type: String,
    enum: ['Received', 'QC_Pending', 'QC_Approved', 'QC_Rejected', 'Partial_Approved', 'Inventory_Updated'],
    default: 'Received'
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
    batchNo: String,
    mfgDate: Date,
    expiryDate: Date
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
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Batch'
  },
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory'
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

// Index for performance
grnSchema.index({ grnId: 1 });
grnSchema.index({ poId: 1 });
grnSchema.index({ grnStatus: 1 });
grnSchema.index({ receivedDate: -1 });
grnSchema.index({ batchNo: 1 });

export default mongoose.model('GRN', grnSchema);
