/**
 * TallyVoucher.js
 * Stores Payment and Receipt vouchers pulled from Tally so ERP has a full
 * picture of cash-flow without duplicating the Invoice/PO models.
 */
import mongoose from 'mongoose';

const tallyVoucherSchema = new mongoose.Schema({
  // Tally identity
  tallyGuid:         { type: String, trim: true, sparse: true, index: true },
  tallyAlterId:      { type: String, trim: true },
  voucherNumber:     { type: String, trim: true, index: true },
  voucherType:       { type: String, enum: ['Payment', 'Receipt', 'Journal', 'Contra', 'Sales', 'Purchase'], required: true },

  // Date & Party
  voucherDate:       { type: Date, default: Date.now },
  partyName:         { type: String, trim: true },
  partyLedgerName:   { type: String, trim: true },

  // Amount
  amount:            { type: Number, default: 0 },
  narration:         { type: String, trim: true },

  // Ledger allocations (as imported from Tally)
  ledgerEntries: [{
    ledgerName:  { type: String },
    amount:      { type: Number },
    isDeemed:    { type: Boolean, default: false },
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
