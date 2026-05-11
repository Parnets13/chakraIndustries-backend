import mongoose from 'mongoose';

const oemBrandSchema = new mongoose.Schema({
  brandId:       { type: String, required: true, unique: true, index: true },
  name:          { type: String, required: true, trim: true },
  code:          { type: String, required: true, trim: true, uppercase: true },
  color:         { type: String, default: '#c0392b' },   // UI accent colour

  // Billing
  billingType:   { type: String, enum: ['Per Unit', 'Lump Sum', 'Monthly Contract'], default: 'Per Unit' },
  ratePerUnit:   { type: Number, default: 0 },
  gstRate:       { type: Number, default: 18 },
  paymentTerms:  { type: String, default: 'Net 30' },
  monthlyTarget: { type: Number, default: 0 },

  // Contact
  contactPerson: { type: String, default: '' },
  contactEmail:  { type: String, default: '' },
  contactPhone:  { type: String, default: '', match: [/^(\d{10})?$/, 'Phone must be 10 digits'] },

  notes:  { type: String, default: '' },
  status: { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

export default mongoose.model('OEMBrand', oemBrandSchema);
