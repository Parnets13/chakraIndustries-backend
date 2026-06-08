import mongoose from 'mongoose';

// ── Alternate material option ─────────────────────────────────────────────────
const alternateSchema = new mongoose.Schema({
  itemName:    { type: String, required: true, trim: true },
  itemCode:    { type: String, trim: true, default: '' },
  vendorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  oemBrand:    { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', default: null },
  unitCost:    { type: Number, default: 0 },
  leadTimeDays:{ type: Number, default: 0 },
  priority:    { type: Number, default: 0 },   // higher = preferred alternate
  notes:       { type: String, default: '' },
}, { _id: true });

// ── Component line ────────────────────────────────────────────────────────────
const componentSchema = new mongoose.Schema({
  // Identity
  itemName:    { type: String, required: true, trim: true },
  itemCode:    { type: String, trim: true, default: '' },
  inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },

  // Quantity
  qty:         { type: Number, required: true, min: 0 },
  unit:        { type: String, default: 'Nos' },
  scrapFactor: { type: Number, default: 0 },   // % extra to account for scrap

  // Classification
  type:        { type: String, enum: ['Raw', 'Sub-Assembly', 'Semi-Finished', 'Consumable', 'Packing', 'Packaging'], default: 'Raw' },
  level:       { type: Number, default: 1 },   // 0=finished, 1=direct, 2=sub-level, etc.

  // Costing
  unitCost:    { type: Number, default: 0 },

  // OEM / vendor linkage
  vendorId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  oemBrand:    { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', default: null },

  // Alternate materials
  alternates:  [alternateSchema],

  // Sub-BOM reference (for multi-level)
  subBomId:    { type: mongoose.Schema.Types.ObjectId, ref: 'BOM', default: null },

  remarks:     { type: String, default: '' },
  isOptional:  { type: Boolean, default: false },
}, { _id: true });

// ── BOM version history entry ─────────────────────────────────────────────────
const versionHistorySchema = new mongoose.Schema({
  version:     { type: String, required: true },
  changedBy:   { type: String, default: '' },
  changeNote:  { type: String, default: '' },
  snapshot:    { type: mongoose.Schema.Types.Mixed },  // full components snapshot
  changedAt:   { type: Date, default: Date.now },
}, { _id: true });

// ── Approval step ─────────────────────────────────────────────────────────────
const approvalStepSchema = new mongoose.Schema({
  approver:    { type: String, required: true },
  role:        { type: String, default: '' },
  status:      { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  remarks:     { type: String, default: '' },
  actionAt:    { type: Date },
}, { _id: true });

// ── BOM ───────────────────────────────────────────────────────────────────────
const bomSchema = new mongoose.Schema({
  bomId:       { type: String, required: true, unique: true, index: true },
  product:     { type: String, required: true, trim: true },
  productCode: { type: String, trim: true, default: '' },
  version:     { type: String, default: 'v1.0' },
  type:        { type: String, enum: ['Finished Good', 'Sub-Assembly', 'Semi-Finished', 'Phantom'], default: 'Finished Good' },
  uom:         { type: String, default: 'Set' },
  description: { type: String, default: '' },

  // OEM linkage — which brand this BOM is for (null = generic)
  oemBrand:    { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', default: null },

  // Approval workflow
  approvalStatus: {
    type: String,
    enum: ['Draft', 'Pending Approval', 'Approved', 'Rejected'],
    default: 'Draft',
  },
  approvalSteps: [approvalStepSchema],
  approvedBy:  { type: String, default: '' },
  approvedAt:  { type: Date },

  // Status
  status:      { type: String, enum: ['Active', 'Draft', 'Obsolete'], default: 'Draft' },

  // Components (multi-level supported via level field + subBomId)
  components:  [componentSchema],

  // Version history
  versionHistory: [versionHistorySchema],

  // Costing
  overheadPct:  { type: Number, default: 0 },   // % overhead on material cost
  labourCost:   { type: Number, default: 0 },   // fixed labour cost per unit
}, { timestamps: true });

// ── Virtuals ──────────────────────────────────────────────────────────────────
bomSchema.virtual('componentCount').get(function () {
  return this.components.length;
});

bomSchema.virtual('materialCost').get(function () {
  return this.components.reduce((s, c) => {
    const qty = c.qty * (1 + (c.scrapFactor || 0) / 100);
    return s + qty * (c.unitCost || 0);
  }, 0);
});

bomSchema.virtual('totalCost').get(function () {
  const mat = this.materialCost;
  return mat * (1 + (this.overheadPct || 0) / 100) + (this.labourCost || 0);
});

export default mongoose.model('BOM', bomSchema);
