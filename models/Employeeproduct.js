import mongoose from 'mongoose';

const employeeProductSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    employeeName:  { type: String, required: true, trim: true },
    employeeId:    { type: String, required: true, trim: true },

    // ── Product details ────────────────────────────────────────────────────
    productName:   { type: String, required: true, trim: true },
    productImage:  { type: String, required: true },
    quantity:      { type: Number, default: 1, min: 1 },
    netQty:        { type: Number, default: 0 },
    unit:          { type: String, default: '', trim: true },
    modelNumber:   { type: String, default: '', trim: true },
    color:         { type: String, default: '', trim: true },
    category:      { type: String, default: '', trim: true },
    brand:         { type: String, default: '', trim: true },
    sku:           { type: String, default: '', trim: true },

    // ── Pricing ────────────────────────────────────────────────────────────
    mrp:           { type: Number, default: 0 },
    billingPrice:  { type: Number, default: 0 },
    sellingPrice:  { type: Number, default: 0 },
    purchasePrice: { type: Number, default: 0 },
    gst:           { type: Number, default: 0 },
    hsnCode:       { type: String, default: '', trim: true },
    barcode:       { type: String, default: '', trim: true },

    // ── Stock ──────────────────────────────────────────────────────────────
    availableStock: { type: Number, default: 0 },
    minStock:       { type: Number, default: 0 },
    maxStock:       { type: Number, default: 0 },
    reorderLevel:   { type: Number, default: 0 },

    // ── Other ──────────────────────────────────────────────
    warranty:      { type: String, default: '', trim: true },
    remark:        { type: String, default: '', trim: true },
    expectedDeliveryDate: { type: Date, required: false, default: () => new Date(Date.now() + 7*24*60*60*1000) },

    // ── Extended spec fields ───────────────────────────────────────────────
    weight:           { type: String, default: '', trim: true },
    dimensions:       { type: String, default: '', trim: true },
    capacity:         { type: String, default: '', trim: true },
    powerConsumption: { type: String, default: '', trim: true },
    voltage:          { type: String, default: '', trim: true },
    energyRating:     { type: String, default: '', trim: true },
    material:         { type: String, default: '', trim: true },
    description:      { type: String, default: '', trim: true },

    // ── Dates ──────────────────────────────────────────────────────────────
    manufacturingDate: { type: Date, default: null },
    expiryDate:        { type: Date, default: null },

    // ── Supplier ──────────────────────────────────────────────────────────
    supplier:         { type: String, default: '', trim: true },
    manufacturer:     { type: String, default: '', trim: true },
    countryOfOrigin:  { type: String, default: '', trim: true },
    batchNumber:      { type: String, default: '', trim: true },
    serialNumber:     { type: String, default: '', trim: true },

    // ── Status / review ────────────────────────────────────────────────────
    status: {
      type: String,
      enum: ['Pending', 'Under Review', 'Approved', 'Rejected'],
      default: 'Pending',
      index: true,
    },
    reviewedBy:  { type: String, default: '' },
    reviewedAt:  { type: Date },
    adminNotes:  { type: String, default: '' },
    creditDate:  { type: Date, default: null },
  },
  { timestamps: true },
);

employeeProductSchema.index({ employeeName: 'text', productName: 'text' });
employeeProductSchema.index({ createdAt: -1 });

export default mongoose.model('Employeeproduct', employeeProductSchema);
