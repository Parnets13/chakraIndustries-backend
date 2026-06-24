import mongoose from 'mongoose';

const salesOrderSchema = new mongoose.Schema({
  orderId:    { type: String, required: true, unique: true },
  customer:   { type: String, required: true, trim: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  // ERP line items (used by ERP web UI)
  items:      [{
    itemId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory' },
    itemName:  { type: String },
    sku:       { type: String },
    quantity:  { type: Number },
    approvedQuantity: { type: Number },
    unitPrice: { type: Number },
    gstPercent: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    totalPrice: { type: Number },
    batchNo:   { type: String }
  }],
  itemCount:     { type: Number, default: 0 },  // count of distinct line items
  totalQuantity: { type: Number, default: 0 },  // sum of all quantities
  subTotal:   { type: Number, default: 0 },
  totalGst:   { type: Number, default: 0 },
  value:      { type: Number, default: 0 },
  priority:   { type: String, enum: ['Low','Normal','High','Urgent'], default: 'Normal' },
  status:     { type: String, enum: ['Order Placed', 'Pending Approval', 'Approved', 'Picking Started', 'Picking Completed', 'Sorting Started', 'Sorting Completed', 'Packing Started', 'Packing Completed', 'Invoice Generated', 'Ready for Dispatch', 'Dispatched', 'Delivered', 'Rejected', 'Cancelled'], default: 'Order Placed' },
  orderDate:  { type: Date, default: Date.now },
  expectedDeliveryDate: { type: Date },
  deliveryAddress: { type: String, default: '' },
  notes:      { type: String, default: '' },
  remarks:    { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
  file:       { type: String, default: '' },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  dealerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer' },
  source:     { type: String, enum: ['ERP', 'DealerApp'], default: 'ERP' },
  cancelReason: { type: String, default: '' },
  // Dealer App line items (richer detail — includes GST per item)
  lineItems: [{
    productId:  { type: mongoose.Schema.Types.ObjectId, ref: 'ItemMaster' },
    sku:        { type: String, default: '' },
    name:       { type: String, default: '' },
    quantity:   { type: Number, default: 0 },
    approvedQuantity: { type: Number },
    unitPrice:  { type: Number, default: 0 },
    gstPercent: { type: Number, default: 0 },
    gstAmount:  { type: Number, default: 0 },
    total:      { type: Number, default: 0 },
    batchNo:    { type: String }
  }],
  statusHistory: [{
    status: { type: String, default: '' },
    at:     { type: Date, default: Date.now },
    note:   { type: String, default: '' },
    by:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  // Dispatch info
  dispatchInfo: {
    vehicleNumber: { type: String, default: '' },
    transportName: { type: String, default: '' },
    lrNumber: { type: String, default: '' },
    dispatchDate: { type: Date }
  },
  // Metadata (for idempotency keys etc.)
  metadata: {
    idempotencyKey: { type: String }
  }
}, { timestamps: true });

// Pre-save hook: keep itemCount and totalQuantity in sync
salesOrderSchema.pre('save', function(next) {
  if (Array.isArray(this.items) && this.items.length > 0) {
    this.itemCount = this.items.length;
  } else if (Array.isArray(this.lineItems) && this.lineItems.length > 0 && !this.itemCount) {
    // Dealer app orders use lineItems; reflect count from lineItems
    this.itemCount = this.lineItems.length;
  }
  next();
});

salesOrderSchema.index({ orderId: 1 });
salesOrderSchema.index({ status: 1 });
salesOrderSchema.index({ customer: 1 });
salesOrderSchema.index({ orderDate: -1 });
salesOrderSchema.index({ customerId: 1 });
salesOrderSchema.index({ dealerId: 1 });

export default mongoose.model('SalesOrder', salesOrderSchema);
