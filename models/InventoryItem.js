import mongoose from 'mongoose';

const inventoryItemSchema = new mongoose.Schema({
  sku:        { type: String, required: true },
  name:       { type: String, required: true },
  qty:        { type: Number, default: 0 },
  unit:       { type: String, default: 'Nos' },
  warehouse:  { type: String, default: 'WH-01' },
  minQty:     { type: Number, default: 0 },
  category:   { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  // Source references
  grnId:      { type: mongoose.Schema.Types.ObjectId, ref: 'GRN' },
  poId:       { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  vendorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  // Tracking
  lastReceivedAt: { type: Date },
  status: {
    type: String,
    enum: ['Active', 'Critical', 'Dead'],
    default: 'Active',
  },
}, { timestamps: true });

export default mongoose.model('InventoryItem', inventoryItemSchema);
