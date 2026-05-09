import mongoose from 'mongoose';

const workOrderSchema = new mongoose.Schema({
  woId: {
    type: String,
    unique: true,
    required: true
  },
  product: {
    type: String,
    required: true
  },
  qty: {
    type: Number,
    required: true
  },
  produced: {
    type: Number,
    default: 0
  },
  shift: {
    type: String,
    enum: ['Morning', 'General', 'Night'],
    default: 'Morning'
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: Date,
  bom: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BOM'
  },
  priority: {
    type: String,
    enum: ['Normal', 'High', 'Urgent'],
    default: 'Normal'
  },
  status: {
    type: String,
    enum: ['Scheduled', 'In-Progress', 'Completed', 'On-Hold', 'Cancelled'],
    default: 'Scheduled'
  },
  approvalStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  remarks: String,
  // Inventory tracking
  requiredMaterials: [{
    itemId: mongoose.Schema.Types.ObjectId,
    itemName: String,
    sku: String,
    requiredQty: Number,
    unit: String,
    availableQty: Number,
    shortfall: Number,
    status: {
      type: String,
      enum: ['Available', 'Partial', 'Unavailable'],
      default: 'Available'
    }
  }],
  inventoryStatus: {
    type: String,
    enum: ['Pending', 'Reserved', 'Consumed', 'Partial'],
    default: 'Pending'
  },
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
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

workOrderSchema.index({ woId: 1 });
workOrderSchema.index({ status: 1 });
workOrderSchema.index({ approvalStatus: 1 });
workOrderSchema.index({ startDate: -1 });

export default mongoose.model('WorkOrder', workOrderSchema);
