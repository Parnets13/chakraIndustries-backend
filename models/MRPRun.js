import mongoose from 'mongoose';

/**
 * MRPRun — one MRP calculation run.
 * Explodes BOM requirements for a set of Work Orders / sales demand,
 * checks current inventory, and generates purchase requirements.
 */
const mrpLineSchema = new mongoose.Schema({
  itemMasterId:    { type: mongoose.Schema.Types.ObjectId, ref: 'ItemMaster', default: null },
  itemName:        { type: String, required: true },
  itemCode:        { type: String, default: '' },
  inventoryItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'InventoryItem', default: null },
  unit:            { type: String, default: 'Nos' },

  // Demand
  grossRequirement:  { type: Number, default: 0 },  // total needed
  scheduledReceipts: { type: Number, default: 0 },  // on-order (open POs)
  onHandQty:         { type: Number, default: 0 },  // current stock
  netRequirement:    { type: Number, default: 0 },  // gross - onHand - scheduled

  // Procurement suggestion
  suggestedOrderQty: { type: Number, default: 0 },
  suggestedVendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
  suggestedOemBrand: { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', default: null },
  estimatedUnitCost: { type: Number, default: 0 },
  estimatedLeadDays: { type: Number, default: 0 },
  requiredByDate:    { type: Date },

  // Action
  action:  { type: String, enum: ['No Action', 'Create PR', 'Expedite PO', 'Use Alternate'], default: 'No Action' },
  prId:    { type: String, default: '' },   // filled when PR is created
  status:  { type: String, enum: ['Open', 'PR Created', 'PO Created', 'Fulfilled'], default: 'Open' },
}, { _id: true });

const mrpRunSchema = new mongoose.Schema({
  mrpId:       { type: String, required: true, unique: true, index: true },
  runDate:     { type: Date, default: Date.now },
  runBy:       { type: String, default: '' },
  description: { type: String, default: '' },

  // Scope — which WOs / BOMs were included
  workOrders:  [{ type: mongoose.Schema.Types.ObjectId, ref: 'WorkOrder' }],
  boms:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'BOM' }],

  // Results
  lines:       [mrpLineSchema],

  // Summary
  totalItems:       { type: Number, default: 0 },
  itemsWithShortage:{ type: Number, default: 0 },
  totalPRsCreated:  { type: Number, default: 0 },
  estimatedCost:    { type: Number, default: 0 },

  status: { type: String, enum: ['Running', 'Completed', 'Failed'], default: 'Running' },
}, { timestamps: true });

export default mongoose.model('MRPRun', mrpRunSchema);
