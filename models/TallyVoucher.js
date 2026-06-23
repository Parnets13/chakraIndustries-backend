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
