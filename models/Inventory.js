import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
    uppercase: true
  },
  name: {
    type: String,
    required: true
  },
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true
  },
  // Inventory Levels
  totalQuantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  availableQuantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  reservedQuantity: {
    type: Number,
    required: true,
    default: 0,
    min: 0
  },
  minQuantity: {
    type: Number,
    required: true,
    default: 0
  },
  unit: {
    type: String,
    required: true,
    default: 'units'
  },
  batch: {
    type: String
  },
  status: {
    type: String,
    enum: ['Active', 'Critical', 'Dead', 'Inactive'],
    default: 'Active'
  },
  location: {
    zone: String,
    rack: String,
    shelf: String,
    bin: String
  },
  unitPrice: {
    type: Number,
    default: 0
  },
  totalValue: {
    type: Number,
    default: 0
  },
  // Tracking
  grnId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GRN'
  },
  qcId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QualityCheck'
  },
  lastMovementDate: Date,
  createdDate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound unique index for SKU + Warehouse + Batch
inventorySchema.index({ sku: 1, warehouse: 1, batch: 1 }, { unique: true });
inventorySchema.index({ warehouse: 1 });
inventorySchema.index({ status: 1 });
inventorySchema.index({ lastMovementDate: -1 });

// Auto-calculate status based on quantity
inventorySchema.pre('save', function(next) {
  // Ensure availableQuantity + reservedQuantity = totalQuantity
  this.availableQuantity = Math.max(0, this.totalQuantity - this.reservedQuantity);
  
  if (this.totalQuantity === 0) {
    this.status = 'Dead';
  } else if (this.availableQuantity < this.minQuantity) {
    this.status = 'Critical';
  } else {
    this.status = 'Active';
  }
  
  // Calculate total value
  this.totalValue = this.totalQuantity * this.unitPrice;
  
  next();
});

export default mongoose.model('Inventory', inventorySchema);
