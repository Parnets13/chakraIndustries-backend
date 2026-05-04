import mongoose from 'mongoose';

const batchSchema = new mongoose.Schema({
  batchNo: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  sku: {
    type: String,
    required: true
  },
  itemName: String,
  quantity: Number,
  unitPrice: {
    type: Number,
    default: 0
  },
  mfgDate: Date,
  expiryDate: Date,
  warehouse: String,
  shelfLifePercentage: Number,
  status: {
    type: String,
    enum: ['Active', 'Critical', 'Expired'],
    default: 'Active'
  },
  grnId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GRN'
  },
  inventoryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory'
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor'
  },
  poId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder'
  }
}, {
  timestamps: true
});

export default mongoose.model('Batch', batchSchema);
