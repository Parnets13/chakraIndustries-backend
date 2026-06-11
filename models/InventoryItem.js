import mongoose from 'mongoose';

const inventoryItemSchema = new mongoose.Schema({
  itemCode:   { type: String, unique: true, sparse: true },
  itemName:   { type: String, default: '' },
  // Legacy-compatible aliases stored directly in the document
  sku:        { type: String, unique: true, sparse: true },
  name:       { type: String, default: '' },
  description: { type: String, default: '' },
  qty:              { type: Number, default: 0 },  // primary qty field used by controller
  currentQuantity:  { type: Number, default: 0 },  // item-master field
  reservedQuantity: { type: Number, default: 0 },
  incomingQuantity: { type: Number, default: 0 },
  minQty:     { type: Number, default: 0 },   // used by controller for status calc
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

// Keep sku and itemCode in sync
inventoryItemSchema.pre('save', function (next) {
  if (this.sku && !this.itemCode) this.itemCode = this.sku;
  if (this.itemCode && !this.sku) this.sku = this.itemCode;
  if (this.name && !this.itemName) this.itemName = this.name;
  if (this.itemName && !this.name) this.name = this.itemName;
  if (this.qty != null && this.currentQuantity == null) this.currentQuantity = this.qty;
  if (this.currentQuantity != null && this.qty == null) this.qty = this.currentQuantity;
  next();
});

export default mongoose.model('InventoryItem', inventoryItemSchema);
