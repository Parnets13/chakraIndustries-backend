import mongoose from 'mongoose';

const oemBrandSchema = new mongoose.Schema({
  brandId:        { type: String, required: true, unique: true, index: true },
  name:           { type: String, required: true, trim: true },
  code:           { type: String, required: true, unique: true, trim: true },
  color:          { type: String, default: '#c0392b' },
  
  // Billing
  billingType:    { type: String, enum: ['Per Unit', 'Per Order', 'Monthly'], default: 'Per Unit' },
  ratePerUnit:    { type: Number, default: 0 },
  gstRate:        { type: Number, default: 18 },
  paymentTerms:   { type: String, default: 'Net 30' },
  
  // Performance
  monthlyTarget:  { type: Number, default: 0 },
  
  // Contact
  contactPerson:  { type: String, default: '' },
  contactEmail:   { type: String, default: '' },
  contactPhone:   { type: String, default: '' },
  
  notes:          { type: String, default: '' },
  status:         { type: String, enum: ['Active', 'Inactive', 'Suspended'], default: 'Active' },
}, { timestamps: true });

export default mongoose.model('OEMBrand', oemBrandSchema);
