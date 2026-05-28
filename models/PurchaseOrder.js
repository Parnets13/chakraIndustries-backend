import mongoose from 'mongoose';

const purchaseOrderSchema = new mongoose.Schema({
  poId: {
    type: String,
    required: true,
    unique: true
  },
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  linkedRFQ: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RFQ'
  },
  items: [{
    name: { type: String, required: true },
    qty: { type: Number, required: true },
    unit: { type: String, required: true },
    basePrice: { type: Number, required: true },
    gst: { type: Number, default: 18 },
    total: { type: Number, required: true }
  }],
  subtotal: {
    type: Number,
    required: true
  },
  gstTotal: {
    type: Number,
    required: true
  },
  grandTotal: {
    type: Number,
    required: true
  },
  deliveryDate: Date,
  status: {
    type: String,
    enum: ['Draft', 'Pending', 'Approved', 'Received', 'Cancelled'],
    default: 'Draft'
  },
  paymentTerms: String,
  shippingAddress: String,
  remarks: String,
  // Tally sync tracking
  tallySync: { type: Boolean, default: false },
  tallySyncAt: { type: Date },
}, {
  timestamps: true
});

export default mongoose.model('PurchaseOrder', purchaseOrderSchema);
