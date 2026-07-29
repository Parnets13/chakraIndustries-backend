import mongoose from 'mongoose';

const productMasterSchema = new mongoose.Schema(
  {
    // ── Basic Info ─────────────────────────────────────────────────────────
    productName:  { type: String, required: true, trim: true },
    category:     { type: String, required: true, trim: true },
    brand:        { type: String, required: true, trim: true },
    sku:          { type: String, required: true, unique: true, trim: true, uppercase: true },
    unit:         { type: String, required: true, trim: true, default: 'Pcs' },
    mrp:          { type: Number, required: true, min: 0 },
    billingPrice: { type: Number, required: true, min: 0 },
    availableStock:{ type: Number, default: 0, min: 0 },
    description:  { type: String, default: '', trim: true },
    status:       { type: String, enum: ['Active', 'Inactive'], default: 'Active', index: true },

    // ── Images ─────────────────────────────────────────────────────────────
    images:       [{ type: String }],           // array of image paths
    primaryImage: { type: String, default: '' },// first/main image

    // ── Specifications ─────────────────────────────────────────────────────
    modelNumber:      { type: String, default: '', trim: true },
    color:            { type: String, default: '', trim: true },
    weight:           { type: String, default: '', trim: true },
    dimensions:       { type: String, default: '', trim: true }, // L×W×H
    capacity:         { type: String, default: '', trim: true },
    powerConsumption: { type: String, default: '', trim: true },
    voltage:          { type: String, default: '', trim: true },
    warranty:         { type: String, default: '', trim: true },
    energyRating:     { type: String, default: '', trim: true },
    material:         { type: String, default: '', trim: true },

    // ── Inventory ──────────────────────────────────────────────────────────
    purchasePrice:    { type: Number, default: 0 },
    sellingPrice:     { type: Number, default: 0 },
    gst:              { type: Number, default: 0 },   // GST %
    hsnCode:          { type: String, default: '', trim: true, uppercase: true },
    barcode:          { type: String, default: '', trim: true },
    minStock:         { type: Number, default: 0 },
    maxStock:         { type: Number, default: 0 },
    reorderLevel:     { type: Number, default: 0 },
    supplier:         { type: String, default: '', trim: true },
    manufacturer:     { type: String, default: '', trim: true },
    countryOfOrigin:  { type: String, default: '', trim: true },
    batchNumber:      { type: String, default: '', trim: true },
    serialNumber:     { type: String, default: '', trim: true },
    manufacturingDate:{ type: Date },
    expiryDate:       { type: Date },

    // ── Meta ───────────────────────────────────────────────────────────────
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

productMasterSchema.index({ productName: 'text', sku: 'text', category: 'text', brand: 'text' });
productMasterSchema.index({ category: 1, brand: 1, status: 1 });

export default mongoose.model('ProductMaster', productMasterSchema);
