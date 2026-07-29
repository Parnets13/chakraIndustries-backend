import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
  },
  email: {
    type: String,
    required: false,
    unique: true,
    sparse: true,  // allows multiple docs without email (null is not unique)
    lowercase: true,
    trim: true,
  },
  mobile: {
    type: String,
    sparse: true, // Allow multiple null values, but unique if present
    trim: true,
  },
  password: {
    type: String,
    minlength: 6,
    select: false, // never returned in queries by default
  },
  role: {
    type: String,
    enum: [
      'super_admin', 'management', 'purchase_manager', 'production_manager',
      'dealer', 'corporate_client', 'employee', 'delivery_logistics',
    ],
    default: 'purchase_manager',
  },
  mobileNumber: { type: String, trim: true },
  department: { type: String, trim: true },
  designation: { type: String, trim: true },
  joiningDate: { type: Date },
  gender: { type: String, trim: true },
  gstNumber: { type: String, trim: true },
  panNumber: { type: String, trim: true },
  industry: { type: String, trim: true },
  profilePhoto: { type: String },
  drivingLicence: { type: String, trim: true },
  vehicleNumber: { type: String, trim: true },
  // Dealer-specific fields
  dealerCode: {
    type: String,
    trim: true,
  },
  zone: {
    type: String,
    trim: true,
  },
  // Registration / profile fields
  address: {
    type: String,
    trim: true,
  },
  city: {
    type: String,
    trim: true,
  },
  state: {
    type: String,
    trim: true,
  },
  pincode: {
    type: String,
    trim: true,
  },
  // Dealer status: 'pending' until admin approves
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  // Profile photo — stored as base64 data URI or HTTPS URL
  photo: {
    type: String,
  },
  isVerified: {
    type: Boolean,
    default: false,
  },
  avatar: {
    type: String, // initials e.g. "AK"
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  addresses: [
    {
      label: { type: String, default: 'Head Office' },
      address: { type: String, required: true },
      city: { type: String },
      state: { type: String },
      pincode: { type: String },
      isDefault: { type: Boolean, default: false }
    }
  ],
  creditLimit: {
    type: Number,
    default: 500000,
  },
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client',
  },
}, { timestamps: true });

// Hash password before saving (only if password exists and is modified)
userSchema.pre('save', async function (next) {
  if (!this.password || !this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Compare password
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model('User', userSchema);
