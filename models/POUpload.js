import mongoose from 'mongoose';

// ── Item of an uploaded PO ────────────────────────────────────────────────────
// Each item tracks how much was ORDERED (requiredQty) and how much has been SENT
// (sentQty, entered manually). Remaining is computed as requiredQty - sentQty.
const poUploadItemSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  hsn:         { type: String, default: '' },
  requiredQty: { type: Number, default: 0 },   // ordered quantity (from PO)
  sentQty:     { type: Number, default: 0 },   // manually entered — how much already sent
  unit:        { type: String, default: 'Nos' },
  rate:        { type: Number, default: 0 },
}, { _id: true });   // _id: true so each item can be updated individually

// ── Uploaded Purchase Order ───────────────────────────────────────────────────
// Records what a company ORDERED. Uploading a PO does NOT mean it is fulfilled —
// the user later updates sentQty per item and the system computes the remaining.
const poUploadSchema = new mongoose.Schema({
  poNumber:    { type: String, default: '' },

  // Company this PO belongs to (for company-wise grouping)
  companyId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Company', default: null },
  companyName: { type: String, default: '' },   // denormalised for fast reads

  vendorName:   { type: String, default: '' },
  buyerName:    { type: String, default: '' },
  buyerAddress: { type: String, default: '' },
  buyerGSTIN:   { type: String, default: '' },

  items:       [poUploadItemSchema],

  // Uploaded PO document (PDF) — path served statically under /uploads
  pdfFile:     { type: String, default: '' },     // e.g. /uploads/po-uploads/po-123.pdf
  pdfFileName: { type: String, default: '' },     // original file name for display

  source:      { type: String, enum: ['pdf', 'excel', 'manual'], default: 'pdf' },
  notes:       { type: String, default: '' },

  // Hidden from the PO Upload page's "Uploaded POs" list only.
  // Deleting from the Upload page sets this true — the PO STILL shows in
  // Company Details (the record is not actually removed).
  hiddenFromUpload: { type: Boolean, default: false },
}, { timestamps: true });

poUploadSchema.index({ companyId: 1 });
poUploadSchema.index({ poNumber: 1 });

export default mongoose.model('POUpload', poUploadSchema);
