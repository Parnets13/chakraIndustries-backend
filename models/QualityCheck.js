import mongoose from 'mongoose';

const qualityCheckSchema = new mongoose.Schema({
  qcId: {
    type: String,
    unique: true,
    required: true
  },
  grnId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GRN',
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
  skuId: {
    type: String,
    required: true
  },
  receivedQuantity: {
    type: Number,
    required: true
  },
  acceptedQuantity: {
    type: Number,
    required: true,
    default: 0
  },
  rejectedQuantity: {
    type: Number,
    required: true,
    default: 0
  },
  rejectionReason: {
    type: String,
    enum: ['Damaged', 'Defective', 'Quantity Mismatch', 'Quality Issue', 'Other'],
    default: 'Other'
  },
  inspectionNotes: String,
  inspectedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  inspectionDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected', 'Partial'],
    default: 'Pending'
  },
  batchNumber: String,
  warehouseId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse'
  },
  storageLocation: {
    zone: String,
    rack: String,
    shelf: String,
    bin: String
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
qualityCheckSchema.index({ grnId: 1, status: 1 });
qualityCheckSchema.index({ skuId: 1 });
qualityCheckSchema.index({ inspectionDate: -1 });

export default mongoose.model('QualityCheck', qualityCheckSchema);
