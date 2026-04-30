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
  qcCompletedDate: Date,
  inventoryUpdatedDate: Date,
  remarks: String,
  items: [{
    skuId: String,
    name: String,
    orderedQty: Number,
    receivedQty: Number,
    condition: {
      type: String,
      enum: ['Good', 'Damaged', 'Partial'],
      default: 'Good'
    },
    batchNumber: String,
    itemRemarks: String
  }],
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

export default mongoose.model('GRN', grnSchema);
