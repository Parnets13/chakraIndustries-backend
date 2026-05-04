import mongoose from 'mongoose';

const maintenanceLogSchema = new mongoose.Schema({
  type:        { type: String, enum: ['Preventive', 'Corrective', 'Emergency'], default: 'Preventive' },
  technician:  { type: String, default: '' },
  description: { type: String, default: '' },
  cost:        { type: Number, default: 0 },
  date:        { type: Date, default: Date.now },
  status:      { type: String, enum: ['Scheduled', 'In Progress', 'Completed', 'Cancelled'], default: 'Scheduled' },
}, { timestamps: true });

const assetSchema = new mongoose.Schema({
  assetId:       { type: String, unique: true, required: true },
  name:          { type: String, required: true, trim: true },
  category:      { type: String, required: true, enum: ['Machinery', 'Material Handling', 'Utilities', 'IT Equipment', 'Vehicles', 'Furniture', 'Other'], default: 'Machinery' },
  location:      { type: String, required: true, trim: true },
  purchaseDate:  { type: Date },
  purchaseValue: { type: Number, default: 0 },
  currentValue:  { type: Number, default: 0 },
  status:        { type: String, enum: ['Active', 'Maintenance', 'Inactive', 'Disposed'], default: 'Active' },
  nextMaintDate: { type: Date },
  serialNumber:  { type: String, default: '' },
  vendor:        { type: String, default: '' },
  warrantyExpiry:{ type: Date },
  description:   { type: String, default: '' },
  maintenanceLogs: [maintenanceLogSchema],
}, { timestamps: true });

// Virtual: depreciation %
assetSchema.virtual('depreciationPct').get(function () {
  if (!this.purchaseValue || this.purchaseValue === 0) return 0;
  return Math.round(((this.purchaseValue - this.currentValue) / this.purchaseValue) * 100);
});

// Virtual: age in years
assetSchema.virtual('ageYears').get(function () {
  if (!this.purchaseDate) return null;
  const ms = Date.now() - new Date(this.purchaseDate).getTime();
  return (ms / (1000 * 60 * 60 * 24 * 365.25)).toFixed(1);
});

// Virtual: lifecycle stage
assetSchema.virtual('lifecycleStage').get(function () {
  const dep = this.depreciationPct;
  if (dep >= 80) return 'End of Life';
  if (this.status === 'Maintenance') return 'Maintenance';
  if (dep >= 50) return 'Aging';
  return 'Active';
});

assetSchema.set('toJSON', { virtuals: true });
assetSchema.set('toObject', { virtuals: true });

export default mongoose.model('Asset', assetSchema);
