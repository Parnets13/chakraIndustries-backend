import mongoose from 'mongoose';

// Tracks remaining/backorder quantities after a partial invoice
const pendingOrderSchema = new mongoose.Schema({
  poId:         { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', required: true },
  poRef:        { type: String },
  poInvoiceId:  { type: mongoose.Schema.Types.ObjectId, ref: 'POInvoice' },
  vendorName:   { type: String, default: '' },
  itemName:     { type: String, required: true },
  requestedQty: { type: Number, required: true },
  invoicedQty:  { type: Number, required: true },
  pendingQty:   { type: Number, required: true },
  unit:         { type: String, default: 'Nos' },
  basePrice:    { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['Pending', 'Fulfilled', 'Cancelled'],
    default: 'Pending',
  },
  notes:        { type: String, default: '' },
}, { timestamps: true });

pendingOrderSchema.index({ poId: 1 });
pendingOrderSchema.index({ status: 1 });

export default mongoose.model('PendingOrder', pendingOrderSchema);
