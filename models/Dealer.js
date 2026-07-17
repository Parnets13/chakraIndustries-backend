import mongoose from 'mongoose';

const dealerSchema = new mongoose.Schema({
  dealerId:    { type: String, unique: true, trim: true }, // Alias for dealerCode for backward compatibility
  dealerName:  { type: String, required: true, trim: true }, // Alias for name
  name:        { type: String, required: true, trim: true },
  ownerName:   { type: String, trim: true, default: '' }, // Alias for contactPerson
  contactPerson:{ type: String, trim: true, default: '' },
  mobile:      { type: String, required: true, trim: true, unique: true }, // Unique mobile
  mobileNumber:{ type: String, required: true, trim: true, unique: true }, // Alias for mobile
  email:       { type: String, lowercase: true, trim: true, unique: true, sparse: true }, // Unique email (sparse allows multiple nulls)
  businessName:{ type: String, trim: true, default: '' },
  shopName:    { type: String, trim: true, default: '' }, // Alias for businessName
  dealerCode:  { type: String, sparse: true, unique: true },
  photo:       { type: String, default: '' },
  profilePhoto:{ type: String, default: '' }, // Alias for photo
  zone:        { type: String, default: '' },
  address:     { type: String, default: '' },
  city:        { type: String, default: '', trim: true },
  state:       { type: String, default: '', trim: true },
  pincode:     { type: String, default: '', trim: true },
  gstin:       { type: String, default: '', unique: true, sparse: true, uppercase: true }, // Unique GSTIN
  gstNumber:   { type: String, default: '', uppercase: true }, // Alias for gstin
  panNumber:   { type: String, default: '', trim: true, uppercase: true },
  creditLimit: { type: Number, default: 0 },
  outstandingAmount: { type: Number, default: 0 },
  erpClientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  isActive:    { type: Boolean, default: true },
  status:      { type: String, default: 'Active', enum: ['Active', 'Inactive', 'Pending'] },
  activeSessions: [{
    sessionId: { type: String, required: true },
    loginTime: { type: Date, required: true },
    deviceInfo: { type: String, default: '' }
  }],
  lastLogin:   { type: Date },
  otpVerified: { type: Boolean, default: false },
  otp:         { type: String, select: false },
  otpExpiry:   { type: Date,   select: false },
}, { timestamps: true });

// Auto-generate dealer code / dealerId before first save
dealerSchema.pre('save', async function (next) {
  if (!this.dealerCode) {
    const count = await mongoose.model('Dealer').countDocuments();
    this.dealerCode = `DLR${String(count + 1).padStart(4, '0')}`;
    this.dealerId = this.dealerCode;
  }
  // Set aliases for backward compatibility
  if (this.name) {
    this.dealerName = this.name;
  }
  if (this.dealerName) {
    this.name = this.dealerName;
  }
  if (this.mobile) {
    this.mobileNumber = this.mobile;
  }
  if (this.mobileNumber) {
    this.mobile = this.mobileNumber;
  }
  if (this.contactPerson) {
    this.ownerName = this.contactPerson;
  }
  if (this.ownerName) {
    this.contactPerson = this.ownerName;
  }
  if (this.businessName) {
    this.shopName = this.businessName;
  }
  if (this.shopName) {
    this.businessName = this.shopName;
  }
  if (this.photo) {
    this.profilePhoto = this.photo;
  }
  if (this.profilePhoto) {
    this.photo = this.profilePhoto;
  }
  if (this.gstin) {
    this.gstNumber = this.gstin;
  }
  if (this.gstNumber) {
    this.gstin = this.gstNumber;
  }
  next();
});

export default mongoose.model('Dealer', dealerSchema);
