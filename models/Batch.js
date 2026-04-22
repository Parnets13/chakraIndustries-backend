import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema({
  batchNumber: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  inventory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true
  },
  sku: {
    type: String,
    required: true
  },
  itemName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    default: 0
  },
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse'
  },
  manufacturingDate: {
    type: Date,
    required: true
  },
  expiryDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['Active', 'Critical', 'Dead', 'Expired'],
    default: 'Active'
  },
  shelfLifePercentage: {
    type: Number,
    default: 100
  }
}, {
  timestamps: true
});

// Calculate shelf life percentage
batchSchema.pre('save', function(next) {
  if (this.expiryDate && this.manufacturingDate) {
    const total = this.expiryDate - this.manufacturingDate;
    const remaining = this.expiryDate - new Date();
    this.shelfLifePercentage = Math.max(0, Math.round((remaining / total) * 100));
  }
  next();
});

export default mongoose.model('Batch', batchSchema);
