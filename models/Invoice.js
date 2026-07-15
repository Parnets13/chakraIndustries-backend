import mongoose from 'mongoose';

// ─── TallyVoucher sub-document ────────────────────────────────────────────────
// Mirrors Tally's Sales Voucher internal structure exactly.
// Populated at write time by normalizeToTallyVoucher() so export is pure serialization.

const billAllocationSchema = new mongoose.Schema({
  name:     { type: String, default: '' },
  billType: { type: String, default: 'New Ref' },
  amount:   { type: Number, default: 0 },
}, { _id: false });

const accountingAllocationSchema = new mongoose.Schema({
  ledgerName:          { type: String, required: true },
  isDeemedPositive:    { type: Boolean, default: false },
  isLastDeemedPositive:{ type: Boolean, default: false },
  amount:              { type: Number, default: 0 },
}, { _id: false });

const ledgerEntrySchema = new mongoose.Schema({
  ledgerName:          { type: String, required: true },
  isDeemedPositive:    { type: Boolean, default: false },
  isLastDeemedPositive:{ type: Boolean, default: false },
  amount:              { type: Number, required: true },
  billAllocations:     { type: [billAllocationSchema], default: [] },
}, { _id: false });

const inventoryEntrySchema = new mongoose.Schema({
  stockItemName:        { type: String, required: true },
  isDeemedPositive:     { type: Boolean, default: false },
  isLastDeemedPositive: { type: Boolean, default: false },
  rate:                 { type: String, default: '' },   // "100.00/Nos"
  amount:               { type: Number, default: 0 },
  actualQty:            { type: String, default: '' },   // "5 Nos"
  billedQty:            { type: String, default: '' },   // "5 Nos"
  accountingAllocations:{ type: [accountingAllocationSchema], default: [] },
  // GST source fields — required by Tally for GST-enabled inventory vouchers
  gstSourceType:        { type: String, default: 'Ledger' },   // GSTSOURCETYPE
  gstLedgerSource:      { type: String, default: '' },          // GSTLEDGERSOURCE
  hsnSourceType:        { type: String, default: 'Ledger' },   // HSNSOURCETYPE
  hsnLedgerSource:      { type: String, default: '' },          // HSNLEDGERSOURCE
  gstOverrideTaxability:{ type: String, default: 'Taxable' },  // GSTOVRDNTAXABILITY
  gstOverrideSupplyType:{ type: String, default: 'Goods' },    // GSTOVRDNTYPEOFSUPPLY
  gstHsnName:           { type: String, default: '' },          // GSTHSNNAME (HSN code)
}, { _id: false });

const tallyVoucherSchema = new mongoose.Schema({
  voucherType:         { type: String, default: 'Sales' },
  voucherNumber:       { type: String, required: true },
  date:                { type: String, required: true },  // YYYYMMDD
  effectiveDate:       { type: String, required: true },  // YYYYMMDD
  partyLedgerName:     { type: String, required: true },
  isinvoice:           { type: Boolean, default: true },
  buyersOrderNo:       { type: String, default: '' },
  // PO Date — YYYYMMDD format, written to BASICORDERDATE in Tally XML
  poDate:              { type: String, default: '' },
  narration:           { type: String, default: '' },
  // Ship To fields — written to BASICBASEPARTYDETAILS.LIST in Tally XML
  shipToName:          { type: String, default: '' },
  shipToAddress:       { type: String, default: '' },
  shipToCity:          { type: String, default: '' },
  shipToState:         { type: String, default: '' },
  shipToGST:           { type: String, default: '' },
  // Bill To fields — written to ADDRESS.LIST in Tally XML
  billToName:          { type: String, default: '' },
  billToAddress:       { type: String, default: '' },
  billToCity:          { type: String, default: '' },
  billToState:         { type: String, default: '' },
  billToGST:           { type: String, default: '' },
  allLedgerEntries:    { type: [ledgerEntrySchema],    default: [] },
  allInventoryEntries: { type: [inventoryEntrySchema], default: [] },
  // Cached computed amounts — stored to avoid recomputation on export
  _grandTotal:  { type: Number, default: 0 },
  _totalCGST:   { type: Number, default: 0 },
  _totalSGST:   { type: Number, default: 0 },
  _totalIGST:   { type: Number, default: 0 },
  _salesBase:   { type: Number, default: 0 },
  _useInventory:{ type: Boolean, default: false },
}, { _id: false });

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
  // Tally-specific: per-item sales ledger name (e.g. "SS Bottle Sales Local 18%")
  // Set from ItemMaster.tallySalesLedger at write time. Falls back to 'Sales Accounts'.
  tallySalesLedger: { type: String, default: '' },
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
  billToName:           { type: String, default: '' },
  billToMailingName:    { type: String, default: '' },
  billToAddress:        { type: String, default: '' },
  billToCity:           { type: String, default: '' },
  billToState:          { type: String, default: '' },
  billToCountry:        { type: String, default: '' },
  billToGST:            { type: String, default: '' },
  billToGstRegType:     { type: String, default: '' },

  // Ship To
  shipToName:           { type: String, default: '' },
  shipToMailingName:    { type: String, default: '' },
  shipToAddress:        { type: String, default: '' },
  shipToCity:           { type: String, default: '' },
  shipToState:          { type: String, default: '' },
  shipToCountry:        { type: String, default: '' },
  shipToGST:            { type: String, default: '' },
  shipToPincode:        { type: String, default: '' },

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
    enum: ['Draft', 'Approved', 'Sent', 'Paid', 'Overdue', 'Cancelled', 'Partial'],
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
  source:       { type: String, enum: ['manual', 'excel_upload', 'Tally', 'tally'], default: 'manual' },
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
  // Tally retry tracking
  retryCount: { type: Number, default: 0 },
  lastError: { type: String, default: '' },
  lastTriedAt: { type: Date },
  tallyAlterId: {
    type: String,
    trim: true
  },
  tallyVoucherNumber: {
    type: String,
    trim: true
  },
  // PO Number from Tally (Buyer's Order No / BuyersOrderNo field)
  buyersOrderNo: {
    type: String,
    trim: true,
    default: ''
  },
  // ── Tally-native voucher sub-document ────────────────────────────────────────
  // Populated by normalizeToTallyVoucher() at write time (upload/create/update).
  // Export path reads this directly — zero field mapping required.
  // null = not yet normalized (legacy invoice or normalization failed).
  tallyVoucher: { type: tallyVoucherSchema, default: null },
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
