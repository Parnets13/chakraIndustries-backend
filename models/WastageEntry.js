import mongoose from 'mongoose';

/**
 * WastageEntry — ERP-grade wastage history model
 *
 * One document per individual wastage save action.
 * Never updated/deleted — append-only audit trail.
 * All aggregations (total scrap, vendor-wise, material-wise) are derived
 * from this collection via the wastage analytics controller.
 */
const wastageEntrySchema = new mongoose.Schema(
  {
    // Auto-generated human-readable ID
    wastageId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },

    // ── Work Order linkage ─────────────────────────────────────────────────
    workOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'WorkOrder',
      required: true,
      index: true,
    },
    woId: { type: String, required: true },        // human-readable WO number

    // ── Product linkage ────────────────────────────────────────────────────
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ItemMaster',
      default: null,
    },
    productName: { type: String, required: true }, // denormalised for fast reads

    // ── Vendor / Supplier linkage ──────────────────────────────────────────
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      default: null,
      index: true,
    },
    vendorName: { type: String, default: '' },     // denormalised

    // ── Material (BOM consumption line) linkage ────────────────────────────
    materialId: {
      type: mongoose.Schema.Types.ObjectId,        // _id of the consumptionSchema sub-doc
      default: null,
    },
    materialName:  { type: String, required: true },
    materialCode:  { type: String, default: '' },

    // ── Quantity & costing ─────────────────────────────────────────────────
    quantity:   { type: Number, required: true, min: 0 },
    unit:       { type: String, default: 'Nos' },
    unitCost:   { type: Number, default: 0 },
    scrapValue: { type: Number, default: 0 },      // quantity × unitCost

    // ── Classification ─────────────────────────────────────────────────────
    reason: { type: String, required: true, trim: true },
    source: {
      type: String,
      enum: ['Production', 'QC Rejection', 'Material Damage', 'Operator Error', 'Other'],
      default: 'Production',
    },

    // ── Dates snapshot (captured at save time from parent WO) ─────────────
    woCreatedAt:    { type: Date, default: null },   // WO creation date
    productionStartDate: { type: Date, default: null },
    productionEndDate:   { type: Date, default: null },
    wastageEntryDate:    { type: Date, default: Date.now }, // this record's date
    qcDate:              { type: Date, default: null },

    // ── Audit trail ───────────────────────────────────────────────────────
    enteredBy:  { type: String, default: '' },
    createdBy:  { type: String, default: '' },
    updatedBy:  { type: String, default: '' },

    // Soft-delete — never hard-delete wastage history
    isDeleted:  { type: Boolean, default: false, index: true },
    deletedBy:  { type: String, default: '' },
    deletedAt:  { type: Date, default: null },

    // Optional QC link
    qcResultId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  {
    timestamps: true,   // createdAt, updatedAt
    toJSON:    { virtuals: true },
    toObject:  { virtuals: true },
  }
);

// ── Indexes for reporting queries ─────────────────────────────────────────────
wastageEntrySchema.index({ workOrderId: 1, materialId: 1 });
wastageEntrySchema.index({ vendorId: 1, createdAt: -1 });
wastageEntrySchema.index({ productId: 1, createdAt: -1 });
wastageEntrySchema.index({ source: 1 });
wastageEntrySchema.index({ createdAt: -1 });
wastageEntrySchema.index({ isDeleted: 1, createdAt: -1 });

export default mongoose.model('WastageEntry', wastageEntrySchema);
