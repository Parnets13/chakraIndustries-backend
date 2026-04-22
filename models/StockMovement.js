import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema({
  movementId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  type: {
    type: String,
    enum: ['Inward', 'Outward', 'Transfer', 'Adjustment'],
    required: true
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
    required: true
  },
  from: {
    type: String,
    required: true
  },
  to: {
    type: String,
    required: true
  },
  reference: {
    type: String
  },
  remarks: {
    type: String
  },
  performedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

export default mongoose.model('StockMovement', stockMovementSchema);
