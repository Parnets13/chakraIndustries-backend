import mongoose from 'mongoose';

// ── Material consumption line ─────────────────────────────────────────────────
const consumptionSchema = new mongoose.Schema({
  itemName:        { type: String, required: true },
  itemCode:        { type: String, default: '' },
  inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
  plannedQty:      { type: Number, default: 0 },
  consumedQty:     { type: Number, default: 0 },
  wastedQty:       { type: Number, default: 0 },           // ✅ Added: Wastage tracking
  wastageReason:   { type: String, default: '' },          // ✅ Added: Why was it wasted
  unit:            { type: String, default: 'Nos' },
  batchNo:         { type: String, default: '' },
  // Which OEM/vendor supplied this material
  vendorId:        { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  oemBrand:        { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', default: null },
  // Was an alternate used?
  isAlternate:     { type: Boolean, default: false },
  alternateFor:    { type: String, default: '' },  // original item name
  unitCost:        { type: Number, default: 0 },
  consumedAt:      { type: Date },
  consumedBy:      { type: String, default: '' },
}, { _id: true });

// ── WIP stage ─────────────────────────────────────────────────────────────────
const wipStageSchema = new mongoose.Schema({
  stage:       { type: String, required: true },   // e.g. 'Assembly', 'Testing', 'Packing'
  status:      { type: String, enum: ['Pending', 'In-Progress', 'Done', 'Rejected'], default: 'Pending' },
  qty:         { type: Number, default: 0 },
  rejectedQty: { type: Number, default: 0 },
  remarks:     { type: String, default: '' },
  startedAt:   { type: Date },
  completedAt: { type: Date },
  operator:    { type: String, default: '' },
}, { _id: true });

// ── QC result on WO ───────────────────────────────────────────────────────────
const woQcSchema = new mongoose.Schema({
  passedQty:   { type: Number, default: 0 },
  rejectedQty: { type: Number, default: 0 },
  defectType:  { type: String, default: '' },
  inspectedBy: { type: String, default: '' },
  inspectedAt: { type: Date },
  remarks:     { type: String, default: '' },
}, { _id: false });

// ── Work Order ────────────────────────────────────────────────────────────────
const workOrderSchema = new mongoose.Schema({
  woId:       { type: String, required: true, unique: true, index: true },
  product:    { type: String, required: true, trim: true },
  bomId:      { type: mongoose.Schema.Types.ObjectId, ref: 'BOM', default: null },
  oemBrand:   { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', default: null },
  oemProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'OEMProduct', default: null },
  salesOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'SalesOrder', default: null },

  // Quantities
  qty:        { type: Number, required: true, min: 1 },
  produced:   { type: Number, default: 0 },
  rejected:   { type: Number, default: 0 },
  wip:        { type: Number, default: 0 },   // in-process qty

  // Scheduling
  shift:      { type: String, enum: ['Morning', 'General', 'Afternoon', 'Night'], default: 'General' },
  priority:   { type: String, enum: ['Low', 'Normal', 'High', 'Urgent'], default: 'Normal' },
  startDate:  { type: Date },
  endDate:    { type: Date },
  actualStart:{ type: Date },
  actualEnd:  { type: Date },
  productionLine: { type: String, default: '' },
  machine:    { type: String, default: '' },
  assignedTeam: { type: String, default: '' },
  supervisor: { type: String, default: '' },

  // Status
  status:     { type: String, enum: ['Pending', 'Released', 'In-Progress', 'WIP', 'QC Pending', 'Completed', 'Cancelled'], default: 'Pending' },

  // Material consumption (auto-populated from BOM when WO is released)
  materialConsumption: [consumptionSchema],
  inventoryDeducted:   { type: Boolean, default: false },

  // WIP stages
  wipStages:  [wipStageSchema],

  // QC
  qcResult:   woQcSchema,
  finishedGoodsPosted: { type: Boolean, default: false },
  finishedGoodsSku:    { type: String, default: '' },
  defectiveStockPosted:{ type: Boolean, default: false },

  // MRP linkage — was this WO created by MRP?
  mrpRunId:   { type: String, default: '' },
  prId:       { type: String, default: '' },   // linked PR if materials needed

  // Costing
  plannedCost:  { type: Number, default: 0 },
  actualCost:   { type: Number, default: 0 },
  
  // ✅ Performance Tracking
  efficiency:   { type: Number, default: 0 },     // (produced/qty)*100
  timeElapsed:  { type: Number, default: 0 },     // minutes
  unitsPerHour: { type: Number, default: 0 },     // production rate

  remarks:    { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('WorkOrder', workOrderSchema);
