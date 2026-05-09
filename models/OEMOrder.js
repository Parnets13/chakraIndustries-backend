import mongoose from 'mongoose';

const oemOrderSchema = new mongoose.Schema({
  oemOrderId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  brandOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BrandOrder',
    required: true
  },
  workOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WorkOrder'
  },
  product: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: String,
  bomId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BOM',
    required: true
  },
  status: {
    type: String,
    enum: ['Created', 'BOM-Loaded', 'Inventory-Validated', 'Material-Reserved', 'In-Production', 'QC-Pending', 'QC-Passed', 'Finished-Goods', 'Dispatch-Ready', 'Invoiced', 'Tally-Synced', 'Completed', 'Cancelled'],
    default: 'Created'
  },
  inventoryStatus: {
    type: String,
    enum: ['Pending', 'Validated', 'Reserved', 'Consumed', 'Partial', 'Unavailable'],
    default: 'Pending'
  },
  productionStatus: {
    type: String,
    enum: ['Pending', 'In-Progress', 'Completed', 'On-Hold'],
    default: 'Pending'
  },
  qcStatus: {
    type: String,
    enum: ['Pending', 'In-Progress', 'Passed', 'Failed', 'Rework'],
    default: 'Pending'
  },
  dispatchStatus: {
    type: String,
    enum: ['Pending', 'Packed', 'Shipped', 'Delivered'],
    default: 'Pending'
  },
  billingStatus: {
    type: String,
    enum: ['Pending', 'Invoiced', 'Paid', 'Partial'],
    default: 'Pending'
  },
  tallyStatus: {
    type: String,
    enum: ['Pending', 'Synced', 'Failed'],
    default: 'Pending'
  },
  // Material tracking
  requiredMaterials: [{
    materialId: mongoose.Schema.Types.ObjectId,
    materialName: String,
    sku: String,
    requiredQty: Number,
    unit: String,
    availableQty: Number,
    reservedQty: Number,
    consumedQty: Number,
    status: {
      type: String,
      enum: ['Available', 'Partial', 'Unavailable'],
      default: 'Available'
    }
  }],
  reservedInventory: [{
    itemId: mongoose.Schema.Types.ObjectId,
    inventoryId: mongoose.Schema.Types.ObjectId,
    qty: Number,
    reservedAt: Date
  }],
  consumedInventory: [{
    itemId: mongoose.Schema.Types.ObjectId,
    inventoryId: mongoose.Schema.Types.ObjectId,
    qty: Number,
    consumedAt: Date
  }],
  // Costing
  estimatedCost: Number,
  actualCost: Number,
  materialCost: Number,
  laborCost: Number,
  overheadCost: Number,
  // QC Details
  qcCheckId: mongoose.Schema.Types.ObjectId,
  qcResult: String,
  defectCount: Number,
  // Finished Goods
  finishedGoodsId: mongoose.Schema.Types.ObjectId,
  batchNumber: String,
  // Dispatch
  dispatchDate: Date,
  trackingNumber: String,
  // Invoice
  invoiceNumber: String,
  invoiceDate: Date,
  invoiceAmount: Number,
  // Tally
  tallyDocumentId: String,
  tallyReference: String,
  tallyError: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
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

oemOrderSchema.index({ oemOrderId: 1 });
oemOrderSchema.index({ brandOrderId: 1 });
oemOrderSchema.index({ status: 1 });
oemOrderSchema.index({ createdAt: -1 });

export default mongoose.model('OEMOrder', oemOrderSchema);
