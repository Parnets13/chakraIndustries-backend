import mongoose from 'mongoose';

const inventoryItemSchema = new mongoose.Schema({
  itemCode:   { type: String, required: true, unique: true },
  itemName:   { type: String, required: true },
  description: { type: String, default: '' },
  currentQuantity: { type: Number, default: 0 },
  reservedQuantity: { type: Number, default: 0 },
  incomingQuantity: { type: Number, default: 0 },
  unit:       { type: String, default: 'Nos' },
  unitPrice:  { type: Number, default: 0 },
  moq:        { type: Number, default: 1 },
  reorderPoint: { type: Number, default: 10 },
  warehouse:  { type: String, default: 'Main Warehouse' },
  location:   { type: String, default: '' },
  category:   { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  gst:        { type: Number, default: 18 },
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
