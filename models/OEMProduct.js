import mongoose from 'mongoose';

const oemProductSchema = new mongoose.Schema({
  oemBrand:           { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', required: true },
  productName:        { type: String, required: true, trim: true },
  oemSku:             { type: String, default: '' },
  oemPartNo:          { type: String, default: '' },
  
  // Pricing & Lead time
  unitPrice:          { type: Number, default: 0 },
  leadTimeDays:       { type: Number, default: 0 },
  warrantyMonths:     { type: Number, default: 0 },
  minOrderQty:        { type: Number, default: 1 },
  uom:                { type: String, default: 'Set' },
  
  // BOM linkage
  bom:                { type: mongoose.Schema.Types.ObjectId, ref: 'BOM', default: null },
  
  // Regional preference
  preferredRegions:   [{ type: String }],
  
  // Auto-select priority (higher = preferred)
  autoSelectPriority: { type: Number, default: 0 },
  
  notes:              { type: String, default: '' },
  status:             { type: String, enum: ['Active', 'Discontinued', 'Inactive'], default: 'Active' },
}, { timestamps: true });

export default mongoose.model('OEMProduct', oemProductSchema);
