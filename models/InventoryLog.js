import mongoose from 'mongoose';

const inventoryLogSchema = new mongoose.Schema({
  timestamp: {
    type: Date,
    default: Date.now
  },
  action: {
    type: String,
    required: true,
    enum: [
      'GRN Approved', 
      'Inventory Created', 
      'Stock Adjustment', 
      'Warehouse Transfer', 
      'QC Approved', 
      'QC Rejected',
      'Dispatch',
      'Material Return',
      'Defective Tagged'
    ]
  },
  sku: {
    type: String,
    required: true
  },
  itemName: String,
  quantity: {
    type: Number,
    required: true
  },
  warehouse: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Warehouse'
  },
  user: {
    type: String,
    default: 'System'
  },
  status: {
    type: String,
    default: 'Success'
  },
  reference: {
    type: String // GRN-XXX, PO-XXX, etc.
  },
  details: String
}, {
  timestamps: true
});

export default mongoose.model('InventoryLog', inventoryLogSchema);
