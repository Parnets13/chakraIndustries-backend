import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema({
  locationId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse',
    required: true
  },
  zone: {
    type: String,
    required: true
  },
  rack: {
    type: String,
    required: true
  },
  shelf: {
    type: String,
    required: true
  },
  bins: [{
    binId: String,
    sku: String,
    quantity: { type: Number, default: 0 }
  }],
  totalCapacity: {
    type: Number,
    required: true,
    default: 100
  },
  usedCapacity: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Maintenance'],
    default: 'Active'
  }
}, {
  timestamps: true
});

// Calculate used capacity
locationSchema.pre('save', function(next) {
  if (this.bins && this.bins.length > 0) {
    this.usedCapacity = this.bins.reduce((sum, bin) => sum + (bin.quantity || 0), 0);
  }
  next();
});

export default mongoose.model('Location', locationSchema);
