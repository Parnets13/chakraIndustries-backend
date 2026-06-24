import mongoose from 'mongoose';

const invoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true },
  hsn:         { type: String, default: '' },
  qty:         { type: Number, required: true },
  unit:        { type: String, default: 'Nos' },
  rate:        { type: Number, required: true },
  discount:    { type: Number, default: 0 },       // percentage
  taxRate:     { type: Number, default: 18 },      // GST %
  basic:       { type: Number, default: 0 },       // taxable amount (qty * rate after discount)
  amount:      { type: Number, required: true },   // qty * rate after discount
  taxAmount:   { type: Number, default: 0 },
  total:       { type: Number, required: true },   // amount + taxAmount
  // Explicit tax breakdown (from Excel or manual entry)
  cgst:        { type: Number, default: 0 },       // CGST amount
  sgst:        { type: Number, default: 0 },       // SGST amount
  igst:        { type: Number, default: 0 },       // IGST amount (inter-state)
}, { _id: false });

const invoiceSchema = new mongoose.Schema({
  invoiceNo:    { type: String, unique: true, required: true },
  invoiceDate:  { type: Date, default: Date.now },
  dueDate:      { type: Date },
  // Link to dealer and sales order
  dealerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer' },
  salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder' },

  // Billed To
  partyName:    { type: String, required: true },
  partyAddress: { type: String, default: '' },
  partyGST:     { type: String, default: '' },
  partyEmail:   { type: String, default: '' },
  partyPhone:   { type: String, default: '' },

  // Bill To (explicit — for GRT format where bill-to differs from ship-to)
  billToName:    { type: String, default: '' },
  billToAddress: { type: String, default: '' },
  billToGST:     { type: String, default: '' },

  // Ship To
  shipToName:    { type: String, default: '' },
  shipToAddress: { type: String, default: '' },

  // Company (billed from)
  companyName:  { type: String, default: 'Sri Chakra Industries' },
  companyAddress:{ type: String, default: '' },
  companyGST:   { type: String, default: '' },

  items:        [invoiceItemSchema],

  subtotal:     { type: Number, default: 0 },
  totalDiscount:{ type: Number, default: 0 },
  totalTax:     { type: Number, default: 0 },
  grandTotal:   { type: Number, default: 0 },

  notes:        { type: String, default: '' },
  terms:        { type: String, default: 'Payment due within 30 days.' },

  status: {
    type: String,
    enum: ['Draft', 'Sent', 'Paid', 'Overdue', 'Cancelled', 'Partial'],
    default: 'Draft',
  },

  paymentStatus: {
    type: String,
    enum: ['Pending', 'Partial', 'Paid'],
    default: 'Pending'
  },
  paidAmount: { type: Number, default: 0 },
  remainingAmount: { type: Number, default: 0 },

  // Source tracking
  source:       { type: String, enum: ['manual', 'excel_upload'], default: 'manual' },
  uploadBatch:  { type: String, default: '' },  // batch ID for bulk uploads

  // Invoice type — set automatically based on item count
  invoiceType:  { type: String, enum: ['single', 'multi'], default: 'single' },

  // Excel order fields — ALL columns from the Orders Excel preserved as-is
  uniqueId:            { type: String, default: '' },   // UniqueId
  purchaseOrderRef:    { type: String, default: '' },   // PurchaseOrder
  poDate:              { type: String, default: '' },   // PODate
  lineNbr:             { type: String, default: '' },   // LineNbr
  biPartNumber:        { type: String, default: '' },   // BIPartNumber
  vendorCode:          { type: String, default: '' },   // VendorCode
  programNumber:       { type: String, default: '' },   // ProgramNumber
  accountNumber:       { type: String, default: '' },   // AccountNumber
  brandName:           { type: String, default: '' },   // BrandName
  orderStatus:         { type: String, default: '' },   // OrderStatus
  biwpo:               { type: String, default: '' },   // BIWPO
  dispatchDate:        { type: String, default: '' },   // DispatchDate
  awb:                 { type: String, default: '' },   // AWB
  courierName:         { type: String, default: '' },   // CourierName
  vendorInvoiceNumber: { type: String, default: '' },   // VendorInvoiceNumber
  poValue:             { type: Number, default: 0 },    // PoValue
  totalQuantity:       { type: Number, default: 0 },    // TotalQuantity
  totalPoValue:        { type: Number, default: 0 },    // TotalPoValue
  courierValue:        { type: Number, default: 0 },    // CourierValue
  totalCourier:        { type: Number, default: 0 },    // TotalCourier
  deliveryDate:        { type: String, default: '' },   // DeliveryDate
  weightKg:            { type: Number, default: 0 },    // Weight (in Kg)
  modeOfTransport:     { type: String, default: '' },   // Mode of Transportation
  lbh:                 { type: String, default: '' },   // LBH
  totalFaceValue:      { type: Number, default: 0 },    // TotalFaceValue
  podSharedLink:       { type: String, default: '' },   // PodSharedLink
  // Ship-to address parts (stored individually for easy display)
  partyCity:           { type: String, default: '' },
  partyState:          { type: String, default: '' },
  partyPostal:         { type: String, default: '' },
  partyCountry:        { type: String, default: '' },
  serialNo:            { type: Number, default: 0 },    // sequential upload serial
  // ── Stock source tracking ────────────────────────────────────────────────────
  // Distinguishes GRN-triggered invoices from manual stock entry invoices
  invoiceSource: {
    type: String,
    enum: ['manual', 'excel_upload', 'grn_receipt', 'manual_stock_entry', 'sales_order'],
    default: 'manual',
  },
  // Link to GRN when invoice is auto-generated from QC approval
  grnId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'GRN',
    default: null,
  },
  // Link to InventoryItem when invoice is auto-generated from manual stock addition
  inventoryItemId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'InventoryItem',
    default: null,
  },

  // Tally sync tracking
  tallySync:           { type: Boolean, default: false },
  tallySyncAt:         { type: Date },
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
}, { timestamps: true });

invoiceSchema.index({ invoiceNo: 1 });
invoiceSchema.index({ status: 1 });
invoiceSchema.index({ partyName: 1 });
invoiceSchema.index({ invoiceDate: -1 });

invoiceSchema.pre('save', function(next) {
  if (this.isModified('grandTotal') || this.isModified('paidAmount')) {
    this.remainingAmount = Math.max(0, this.grandTotal - this.paidAmount);
    if (this.paidAmount <= 0) {
      this.paymentStatus = 'Pending';
    } else if (this.paidAmount >= this.grandTotal) {
      this.paymentStatus = 'Paid';
    } else {
      this.paymentStatus = 'Partial';
    }
  }
  next();
});

export default mongoose.model('Invoice', invoiceSchema);
