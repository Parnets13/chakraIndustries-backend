import mongoose from 'mongoose';

// ─── Stock Invoice Archive ────────────────────────────────────────────────────
// Permanent archive of invoices uploaded via /finance/invoices/single.
// Records here are NEVER deleted when the original invoice is removed from the
// main Invoice collection. This provides a tamper-proof history/audit trail.

const archiveItemSchema = new mongoose.Schema({
  description:      { type: String, default: '' },
  hsn:              { type: String, default: '' },
  qty:              { type: Number, default: 0 },
  unit:             { type: String, default: 'Nos' },
  rate:             { type: Number, default: 0 },
  discount:         { type: Number, default: 0 },
  taxRate:          { type: Number, default: 18 },
  basic:            { type: Number, default: 0 },
  amount:           { type: Number, default: 0 },
  taxAmount:        { type: Number, default: 0 },
  total:            { type: Number, default: 0 },
  cgst:             { type: Number, default: 0 },
  sgst:             { type: Number, default: 0 },
  igst:             { type: Number, default: 0 },
  tallySalesLedger: { type: String, default: '' },
}, { _id: false });

const stockInvoiceArchiveSchema = new mongoose.Schema({
  // Reference to the original invoice (may no longer exist if deleted)
  originalInvoiceId: { type: mongoose.Schema.Types.ObjectId, index: true },

  // Core invoice fields — snapshot at time of archiving
  invoiceNo:    { type: String, required: true, index: true },
  invoiceDate:  { type: Date, default: Date.now },
  dueDate:      { type: Date },

  partyName:    { type: String, default: '' },
  partyAddress: { type: String, default: '' },
  partyGST:     { type: String, default: '' },
  partyEmail:   { type: String, default: '' },
  partyPhone:   { type: String, default: '' },
  partyCity:    { type: String, default: '' },
  partyState:   { type: String, default: '' },

  // Bill To
  billToName:    { type: String, default: '' },
  billToAddress: { type: String, default: '' },
  billToGST:     { type: String, default: '' },

  // Ship To
  shipToName:    { type: String, default: '' },
  shipToAddress: { type: String, default: '' },
  shipToState:   { type: String, default: '' },
  shipToCity:    { type: String, default: '' },

  // Company
  companyName:   { type: String, default: 'Sri Chakra Industries' },
  companyAddress:{ type: String, default: '' },
  companyGST:    { type: String, default: '' },

  items: [archiveItemSchema],

  subtotal:      { type: Number, default: 0 },
  totalDiscount: { type: Number, default: 0 },
  totalTax:      { type: Number, default: 0 },
  grandTotal:    { type: Number, default: 0 },

  notes:  { type: String, default: '' },
  terms:  { type: String, default: '' },
  status: { type: String, default: 'Draft' },

  // Source tracking
  source:        { type: String, default: 'excel_upload' },
  invoiceType:   { type: String, enum: ['single', 'multi'], default: 'single' },
  uploadBatch:   { type: String, default: '' },

  // PO / Order fields
  purchaseOrderRef: { type: String, default: '' },
  poDate:           { type: String, default: '' },
  uniqueId:         { type: String, default: '' },
  vendorCode:       { type: String, default: '' },
  brandName:        { type: String, default: '' },
  orderStatus:      { type: String, default: '' },

  // Timestamps of the original invoice
  originalCreatedAt: { type: Date },
  originalUpdatedAt: { type: Date },
}, { timestamps: true });

// Compound index for search + pagination
stockInvoiceArchiveSchema.index({ createdAt: -1 });
stockInvoiceArchiveSchema.index({ partyName: 1, invoiceNo: 1 });

export default mongoose.model('StockInvoiceArchive', stockInvoiceArchiveSchema);
