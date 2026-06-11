import mongoose from 'mongoose';

const dealerSchema = new mongoose.Schema({
  name:        { type: String, required: true, trim: true },
  mobile:      { type: String, required: true, unique: true, trim: true },
  dealerCode:  { type: String, unique: true, sparse: true },
  email:       { type: String, lowercase: true, trim: true },
  businessName:{ type: String, trim: true, default: '' },
  contactPerson:{ type: String, trim: true, default: '' },
  zone:        { type: String, default: '' },
  address:     { type: String, default: '' },
  city:        { type: String, default: '', trim: true },
  state:       { type: String, default: '', trim: true },
  pincode:     { type: String, default: '', trim: true },
  gstin:       { type: String, default: '' },
  panNumber:   { type: String, default: '', trim: true, uppercase: true },
  creditLimit: { type: Number, default: 0 },
  outstandingAmount: { type: Number, default: 0 },
  erpClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  isActive:    { type: Boolean, default: true },
  otp:         { type: String, select: false },
  otpExpiry:   { type: Date,   select: false },
}, { timestamps: true });

// Auto-generate dealer code before first save
dealerSchema.pre('save', async function (next) {
  if (!this.dealerCode) {
    const count = await mongoose.model('Dealer').countDocuments();
    this.dealerCode = `DLR${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

export default mongoose.model('Dealer', dealerSchema);
