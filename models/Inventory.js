import mongoose from 'mongoose';

const inventorySchema = new mongoose.Schema({
  sku: {
    type: String,
    required: true,
    unique: true,
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
  quantity: {
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
  }
}, {
  timestamps: true
});

// Auto-calculate status based on quantity
inventorySchema.pre('save', function(next) {
  if (this.quantity === 0) {
    this.status = 'Dead';
  } else if (this.quantity < this.minQuantity) {
    this.status = 'Critical';
  } else {
    this.status = 'Active';
  }
  
  // Calculate total value
  this.totalValue = this.quantity * this.unitPrice;
  
  next();
});

export default mongoose.model('Inventory', inventorySchema);
