import mongoose from 'mongoose';

/**
 * OEMProduct — links one master product to one OEM brand.
 * The same master product can have multiple OEM mappings (one per brand).
 * Each mapping carries brand-specific SKU, price, lead time, warranty, BOM.
 */
const oemProductSchema = new mongoose.Schema({
  oemBrand:      { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', required: true, index: true },

  // Master product reference (optional — can be free-text if ItemMaster not used)
  masterProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'ItemMaster', default: null },
  productName:   { type: String, required: true, trim: true },   // denormalised for speed

  // OEM-specific identifiers
  oemSku:        { type: String, trim: true, default: '' },       // brand's own part number
  oemPartNo:     { type: String, trim: true, default: '' },

  // OEM-specific pricing
  unitPrice:     { type: Number, default: 0 },
  currency:      { type: String, default: 'INR' },

  // OEM-specific supply terms
  leadTimeDays:  { type: Number, default: 0 },
  warrantyMonths:{ type: Number, default: 0 },
  minOrderQty:   { type: Number, default: 1 },

  // BOM reference (from the BOM module)
  bom:           { type: mongoose.Schema.Types.ObjectId, ref: 'BOM', default: null },

  // Auto-selection rules
  preferredRegions: [{ type: String }],   // e.g. ['North', 'West']
  autoSelectPriority: { type: Number, default: 0 }, // higher = preferred

  uom:    { type: String, default: 'Set' },
  status: { type: String, enum: ['Active', 'Inactive', 'Discontinued'], default: 'Active' },
  notes:  { type: String, default: '' },
}, { timestamps: true });

// Compound index — one OEM SKU per brand
oemProductSchema.index({ oemBrand: 1, oemSku: 1 }, { sparse: true });

export default mongoose.model('OEMProduct', oemProductSchema);
