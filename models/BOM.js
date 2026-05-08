import mongoose from 'mongoose';

const componentSchema = new mongoose.Schema({
  itemName:    { type: String, required: true, trim: true },
  itemCode:    { type: String, trim: true, default: '' },
  qty:         { type: Number, required: true, min: 0 },
  unit:        { type: String, default: 'Nos' },
  type:        { type: String, enum: ['Raw', 'Sub-Assembly', 'Consumable', 'Packing'], default: 'Raw' },
  unitCost:    { type: Number, default: 0 },
  remarks:     { type: String, default: '' },
}, { _id: true });

const bomSchema = new mongoose.Schema({
  bomId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  product:     { type: String, required: true, trim: true },
  productCode: { type: String, trim: true, default: '' },
  version:     { type: String, default: 'v1.0' },
  type:        { type: String, enum: ['Finished Good', 'Sub-Assembly', 'Semi-Finished'], default: 'Finished Good' },
  uom:         { type: String, default: 'Set' },
  description: { type: String, default: '' },
  status:      { type: String, enum: ['Active', 'Draft', 'Obsolete'], default: 'Active' },
  components:  [componentSchema],
}, { timestamps: true });

// Virtual: total component count
bomSchema.virtual('componentCount').get(function () {
  return this.components.length;
});

// Virtual: total material cost
bomSchema.virtual('totalCost').get(function () {
  return this.components.reduce((sum, c) => sum + (c.qty * c.unitCost), 0);
});

export default mongoose.model('BOM', bomSchema);
