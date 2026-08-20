import mongoose from 'mongoose';

// Tracks partial invoices generated against a Purchase Order
const poInvoiceItemSchema = new mongoose.Schema({
  itemName:       { type: String, required: true },
  requestedQty:   { type: Number, required: true },
  availableQty:   { type: Number, required: true },
  invoicedQty:    { type: Number, required: true },
  pendingQty:     { type: Number, required: true },
  unit:           { type: String, default: 'Nos' },
  basePrice:      { type: Number, default: 0 },
  gst:            { type: Number, default: 18 },
  cgst:           { type: Number, default: 0 },
  sgst:           { type: Number, default: 0 },
  igst:           { type: Number, default: 0 },
  cgstVal:        { type: Number, default: 0 },
  sgstVal:        { type: Number, default: 0 },
  igstVal:        { type: Number, default: 0 },
  discount:       { type: Number, default: 0 },
  taxableValue:   { type: Number, default: 0 },
  lineTotal:      { type: Number, default: 0 },
  hsn:            { type: String, default: '' },

  // ── Delivery tracking per item ──────────────────────────────────────────
  deliveryStatus: {
    type: String,
    enum: ['Pending', 'Delivered', 'Not Delivered', 'Partially Delivered'],
    default: 'Pending',
  },
  deliveredQty:   { type: Number, default: 0 },
  deliveryDate:   { type: Date, default: null },
  deliveryNotes:  { type: String, default: '' },

  // ── Dispatch tracking (company-wise item management) ─────────────────────
  dispatchStatus: {
    type: String,
    enum: ['Pending', 'Sent', 'Not Sent', 'Partially Sent'],
    default: 'Pending',
  },
  notSentReason:    { type: String, default: '' },   // reason why item was not sent
  expectedSendDate: { type: Date,   default: null },  // when it will be sent
  dispatchRemarks:  { type: String, default: '' },   // any additional notes
}, { _id: true });   // _id: true so we can update individual items by _id

const poInvoiceSchema = new mongoose.Schema({
  invoiceNo:    { type: String, unique: true, required: true },
  // ── Company-wise segregation ──────────────────────────────────────────────
  companyId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
  companyName:  { type: String, default: '' },   // denormalised for fast reads
  // ─────────────────────────────────────────────────────────────────────────
  poId:         { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder', default: null },
  poRef:        { type: String, default: '' },
  vendorName:   { type: String, default: '' },
  buyerName:    { type: String, default: '' },
  buyerAddress: { type: String, default: '' },
  buyerGSTIN:   { type: String, default: '' },
  shipToName:   { type: String, default: '' },
  shipToAddress:{ type: String, default: '' },
  items:        [poInvoiceItemSchema],

  subtotal:     { type: Number, default: 0 },
  gstTotal:     { type: Number, default: 0 },
  grandTotal:   { type: Number, default: 0 },

  invoiceType: {
    type: String,
    enum: ['full', 'partial'],
    default: 'partial',
  },
  status: {
    type: String,
    enum: ['Draft', 'Approved', 'Sent', 'Paid', 'Cancelled'],
    default: 'Draft',
  },

  // ── Invoice-level delivery status (auto-computed) ───────────────────────
  deliveryStatus: {
    type: String,
    enum: ['Pending', 'Partially Delivered', 'Fully Delivered'],
    default: 'Pending',
  },
  deliveryCompletedAt: { type: Date, default: null },

  notes: { type: String, default: '' },

  // ── Tally export tracking (mirrors Invoice model) ──────────────────────────
  tallySync:   { type: Boolean, default: false },
  tallySyncAt: { type: Date, default: null },
  tallyGuid:   { type: String, trim: true, default: '' },
  retryCount:  { type: Number, default: 0 },
  lastError:   { type: String, default: '' },
  lastTriedAt: { type: Date, default: null },
}, { timestamps: true });

poInvoiceSchema.index({ poId: 1 }, { sparse: true });
poInvoiceSchema.index({ companyId: 1 }, { sparse: true });
poInvoiceSchema.index({ invoiceNo: 1 });
poInvoiceSchema.index({ status: 1 });
poInvoiceSchema.index({ deliveryStatus: 1 });

export default mongoose.model('POInvoice', poInvoiceSchema);
