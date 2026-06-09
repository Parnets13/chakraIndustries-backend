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
    required: [true, 'Email is required'],
    unique: true,
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
    enum: ['super_admin', 'management', 'purchase_manager', 'production_manager', 'dealer', 'corporate_client'],
    default: 'purchase_manager',
  },
  // Dealer-specific fields
  dealerCode: {
    type: String,
    trim: true,
  },
  zone: {
    type: String,
    trim: true,
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
