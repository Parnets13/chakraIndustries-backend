/**
 * TallyVoucher.js
 * Stores Payment and Receipt vouchers pulled from Tally so ERP has a full
 * picture of cash-flow without duplicating the Invoice/PO models.
 */
import mongoose from 'mongoose';

const tallyVoucherSchema = new mongoose.Schema({
  // Tally identity
  tallyGuid:         { type: String, trim: true, required: true, unique: true },
  tallyAlterId:      { type: String, trim: true },
  voucherNumber:     { type: String, trim: true },
  voucherType:       { type: String, enum: ['Payment', 'Receipt', 'Journal', 'Contra', 'Sales', 'Purchase', 'Debit Note', 'Credit Note'], required: true },

  // Date & Party
  voucherDate:       { type: Date, default: Date.now },
  partyName:         { type: String, trim: true },
  partyLedgerName:   { type: String, trim: true },

  // Amount
  amount:            { type: Number, default: 0 },
  subtotal:          { type: Number, default: 0 },   // sum of inventory items (before tax)
  taxTotal:          { type: Number, default: 0 },   // sum of GST lines
  narration:         { type: String, trim: true },
  partyGstin:        { type: String, trim: true },
  placeOfSupply:     { type: String, trim: true },

  // E-invoice fields
  irn:               { type: String, trim: true },
  ackNo:             { type: String, trim: true },
  ackDate:           { type: Date },

  // Delivery & reference fields
  deliveryNote:      { type: String, trim: true },
  referenceNo:       { type: String, trim: true },
  referenceDate:     { type: Date },
  buyersOrderNo:     { type: String, trim: true },
  buyersOrderDate:   { type: Date },
  dispatchDocNo:     { type: String, trim: true },
  dispatchedThrough: { type: String, trim: true },
  destination:       { type: String, trim: true },
  billOfLadingNo:    { type: String, trim: true },
  motorVehicleNo:    { type: String, trim: true },
  termsOfDelivery:   { type: String, trim: true },

  // Bill To & Ship To (full Tally details)
  billToName:        { type: String, trim: true },
  billToMailingName: { type: String, trim: true },
  billToAddress:     { type: String, trim: true },
  billToCity:        { type: String, trim: true },
  billToState:       { type: String, trim: true },
  billToCountry:     { type: String, trim: true },
  billToGST:         { type: String, trim: true },
  billToGstRegType:  { type: String, trim: true },
  shipToName:        { type: String, trim: true },
  shipToMailingName: { type: String, trim: true },
  shipToAddress:     { type: String, trim: true },
  shipToCity:        { type: String, trim: true },
  shipToState:       { type: String, trim: true },
  shipToCountry:     { type: String, trim: true },
  shipToGST:         { type: String, trim: true },

  // Ledger allocations (as imported from Tally)
  ledgerEntries: [{
    ledgerName:  { type: String },
    amount:      { type: Number },
    isDeemed:    { type: Boolean, default: false },
  }],

  // Tax lines extracted from ledger entries (CGST/SGST/IGST)
  taxLines: [{
    ledgerName: { type: String },
    amount:     { type: Number },
  }],

  // Inventory entries (for Sales/Purchase vouchers)
  inventoryEntries: [{
    stockItemName: { type: String },
    qty:           { type: Number },
    rate:          { type: Number },
    amount:        { type: Number },
    taxEntries: [{
      ledgerName: { type: String },
      amount:     { type: Number },
    }],
  }],

  // Bill allocations
  billAllocations: [{
    billName: { type: String },
    amount:   { type: Number },
  }],

  // Linked ERP records
  linkedInvoiceId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Invoice' },
  linkedPoId:        { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },

  // Sync metadata
  syncedAt:          { type: Date, default: Date.now },
  source:            { type: String, enum: ['Tally', 'ERP'], default: 'Tally' },
}, { timestamps: true });

tallyVoucherSchema.index({ voucherType: 1, voucherDate: -1 });
tallyVoucherSchema.index({ partyName: 1 });

export default mongoose.model('TallyVoucher', tallyVoucherSchema);
