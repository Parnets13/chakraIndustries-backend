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
      enum: ['Raw Material', 'Components', 'Bearings', 'Castings', 'Seals & Gaskets', 'Electrical', 'Packaging', 'Tools & Consumables'],
      required: [true, 'Category is required']
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
      match: [/^\d{10}$/, 'Phone must be 10 digits']
    },
    alternatePhone: String,
    email: {
      type: String,
      required: [true, 'Email is required'],
      match: [/^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email format']
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
      match: [/^\d{6}$/, 'Pincode must be 6 digits']
    },
    country: {
      type: String,
      default: 'India'
    },
    
    // Financial Information
    gstNumber: {
      type: String,
      required: [true, 'GST number is required'],
      uppercase: true,
      trim: true,
      match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST format - must be 15 characters: 2 digits, 5 letters, 4 digits, 1 letter, 1 alphanumeric, Z, 1 alphanumeric']
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
