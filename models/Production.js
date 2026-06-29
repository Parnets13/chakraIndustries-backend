import mongoose from 'mongoose';

const productionSchema = new mongoose.Schema({
  productionNo:   { type: String, unique: true },
  productionDate: { type: Date, required: true },
  companyName:    { type: String, required: true, trim: true },
  productName:    { type: String, required: true, trim: true },
  productCode:    { type: String, default: '', trim: true },
  category:       { type: String, default: '' },
  unit:           { type: String, default: 'Nos' },
  machineName:    { type: String, default: '' },
  operatorName:   { type: String, default: '' },
  supervisorName: { type: String, default: '' },
  shift:          { type: String, enum: ['Morning', 'Evening', 'Night', 'General', ''], default: '' },
  plannedQty:     { type: Number, default: 0, min: 0 },
  producedQty:    { type: Number, default: 0, min: 0 },
  goodQty:        { type: Number, default: 0, min: 0 },
  damagedQty:     { type: Number, default: 0, min: 0 },
  rejectedQty:    { type: Number, default: 0, min: 0 },
  reworkQty:      { type: Number, default: 0, min: 0 },
  damagePercentage:     { type: Number, default: 0 },
  efficiencyPercentage: { type: Number, default: 0 },
  damageReason:   { type: String, default: '' },
  remarks:        { type: String, default: '' },
  // Pricing
  sellingPrice:   { type: Number, default: 0 },
  costPrice:      { type: Number, default: 0 },
  unitPrice:      { type: Number, default: 0 },
  gstPct:         { type: Number, default: 0 },
  // Computed financials (stored for reporting)
  totalGoodValue: { type: Number, default: 0 },
  totalLoss:      { type: Number, default: 0 },
  netProfit:      { type: Number, default: 0 },
  status:         { type: String, enum: ['Draft', 'Completed', 'Approved', 'On Hold', 'Cancelled'], default: 'Completed' },
  createdBy:      { type: String, default: 'Admin' },
}, { timestamps: true });

productionSchema.pre('save', async function (next) {
  if (!this.productionNo) {
    const count = await mongoose.model('Production').countDocuments();
    this.productionNo = `PRD-${String(count + 1).padStart(5, '0')}`;
  }
  if (this.producedQty > 0) {
    this.damagePercentage = parseFloat(((this.damagedQty / this.producedQty) * 100).toFixed(2));
  }
  if (this.plannedQty > 0) {
    this.efficiencyPercentage = parseFloat(((this.goodQty / this.plannedQty) * 100).toFixed(2));
  }
  // Compute financials
  this.totalGoodValue = parseFloat(((this.goodQty || 0) * (this.sellingPrice || 0)).toFixed(2));
  this.totalLoss      = parseFloat((((this.damagedQty || 0) + (this.rejectedQty || 0)) * (this.costPrice || this.sellingPrice || 0)).toFixed(2));
  this.netProfit      = parseFloat((this.totalGoodValue - this.totalLoss).toFixed(2));
  next();
});

export default mongoose.model('Production', productionSchema);
