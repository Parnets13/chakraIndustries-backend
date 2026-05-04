import mongoose from 'mongoose';

const vendorSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    companyName: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true
    },
    category: {
      type: String,
      required: [true, 'Category is required'],
      trim: true
    },
    website: {
      type: String,
      trim: true
    },
    establishedYear: Number,
    
    // Contact Information
    contactPerson: {
      type: String,
      required: [true, 'Contact person is required'],
      trim: true
    },
    designation: String,
    phone: {
      type: String,
      required: [true, 'Phone is required'],
    },
    alternatePhone: String,
    email: {
      type: String,
      required: [true, 'Email is required'],
    },
    alternateEmail: String,
    
    // Address Information
    address: {
      type: String,
      required: [true, 'Address is required']
    },
    city: {
      type: String,
      required: [true, 'City is required']
    },
    state: {
      type: String,
      required: [true, 'State is required']
    },
    pincode: {
      type: String,
      required: [true, 'Pincode is required'],
    },
    country: {
      type: String,
      default: 'India'
    },
    
    // Financial Information
    gstNumber: {
      type: String,
      uppercase: true,
      trim: true,
    },
    panNumber: {
      type: String,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN format']
    },
    bankName: String,
    accountNumber: String,
    ifscCode: String,
    creditLimit: {
      type: Number,
      default: 0
    },
    
    // Business Terms
    paymentTerms: {
      type: String,
      enum: ['Net 30', 'Net 45', 'Net 60', 'Net 90', 'Advance Payment', 'COD'],
      default: 'Net 30'
    },
    leadTimeDays: {
      type: Number,
      default: 0
    },
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: 3
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Blacklisted'],
      default: 'Active'
    },
    remarks: String
  },
  {
    timestamps: true
  }
);

// Pre-save hook to clean GST number
vendorSchema.pre('save', function(next) {
  if (this.gstNumber) {
    this.gstNumber = this.gstNumber.toUpperCase().trim();
  }
  next();
});

export default mongoose.model('Vendor', vendorSchema);
