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
  sentHistory: [{
    sentAt: { type: Date, default: Date.now },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    method: { type: String, enum: ['email', 'whatsapp'], required: true },
    recipient: { type: String, required: true }
  }],
  // Data source — 'ERP' for records created in this system, 'Tally' for records imported from Tally.
  // Only 'ERP' records are eligible for export back to Tally.
  dataSource: {
    type: String,
    enum: ['ERP', 'Tally'],
    default: 'ERP',
    index: true
  },

  // Tally sync tracking
  tallySync: { type: Boolean, default: false },
  tallySyncAt: { type: Date },
  tallyGuid: {
    type: String,
    trim: true,
    sparse: true,
    index: true
  },
  tallyAlterId: {
    type: String,
    trim: true
  },
  tallyVoucherNumber: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

export default mongoose.model('PurchaseOrder', purchaseOrderSchema);
