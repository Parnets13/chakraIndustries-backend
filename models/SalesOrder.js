import mongoose from 'mongoose';

const salesOrderSchema = new mongoose.Schema({
  orderId:    { type: String, required: true, unique: true },
  customer:   { type: String, required: true, trim: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  items:      { type: Number, default: 0 },
  value:      { type: Number, default: 0 },
  priority:   { type: String, enum: ['Low','Normal','High','Urgent'], default: 'Normal' },
  status:     { type: String, enum: ['Pending','Processing','Shipped','Delivered','Cancelled'], default: 'Pending' },
  orderDate:  { type: Date, default: Date.now },
  remarks:    { type: String, default: '' },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  dealerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer' },
  source:     { type: String, enum: ['ERP', 'DealerApp'], default: 'ERP' },
  deliveryAddress: { type: String, default: '' },
  notes: { type: String, default: '' },
  cancelReason: { type: String, default: '' },
  lineItems: [
    {
      productId: { type: mongoose.Schema.Types.ObjectId, ref: 'ItemMaster' },
      sku: { type: String, default: '' },
      name: { type: String, default: '' },
      quantity: { type: Number, default: 0 },
      unitPrice: { type: Number, default: 0 },
      total: { type: Number, default: 0 },
    },
  ],
  statusHistory: [
    {
      status: { type: String, default: '' },
      at: { type: Date, default: Date.now },
      note: { type: String, default: '' },
    },
  ],
}, { timestamps: true });

salesOrderSchema.index({ orderId: 1 });
salesOrderSchema.index({ status: 1 });
salesOrderSchema.index({ customer: 1 });
salesOrderSchema.index({ orderDate: -1 });
salesOrderSchema.index({ customerId: 1 });
salesOrderSchema.index({ dealerId: 1 });

export default mongoose.model('SalesOrder', salesOrderSchema);
