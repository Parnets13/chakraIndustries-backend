import mongoose from 'mongoose';

// Price mapping: one vendor → many products with prices
const vendorPriceSchema = new mongoose.Schema({
  vendor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true,
  },
  productName: {
    type: String,
    required: [true, 'Product name is required'],
    trim: true,
  },
  productCode: {
    type: String,
    trim: true,
  },
  unit: {
    type: String,
    default: 'pcs', // pcs, kg, ltr, mtr, etc.
  },
  unitPrice: {
    type: Number,
    required: [true, 'Unit price is required'],
    min: 0,
  },
  currency: {
    type: String,
    default: 'INR',
  },
  minOrderQty: {
    type: Number,
    default: 1,
  },
  leadTimeDays: {
    type: Number,
    default: 0,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  notes: String,
}, { timestamps: true });

// Compound index — one product code per vendor
vendorPriceSchema.index({ vendor: 1, productCode: 1 }, { sparse: true });

export default mongoose.model('VendorPrice', vendorPriceSchema);
