import mongoose from 'mongoose';

const vendorSchema = new mongoose.Schema(
  {
    vendorId: {
      type: String,
      unique: true,
      sparse: true,   // allow null during upsert — set only on insert
      index: true
    },
    companyName: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true
    },
    category: {
      type: String,
      trim: true,
      default: 'General',
    },
    website: {
      type: String,
      trim: true
    },
    establishedYear: Number,
    
    // Contact Information
    contactPerson: {
      type: String,
      trim: true,
      default: '',
    },
    designation: String,
    phone: {
      type: String,
      // Relaxed validation — Tally-imported vendors may have non-standard formats
      // The frontend form enforces 10-digit validation on manual entry
      trim: true,
      default: '',
    },
    alternatePhone: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      default: '',
    },
    alternateEmail: String,
    
    // Address Information
    address: {
      type: String,
      trim: true,
      default: '',
    },
    city: {
      type: String,
      trim: true,
      default: '',
    },
    state: {
      type: String,
      trim: true,
      default: '',
    },
    pincode: {
      type: String,
      trim: true,
      default: '',
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
      trim: true,
      // Relaxed — PAN validation applied in frontend only, not on sync imports
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
    remarks: String,
    
    // Tally Integration Fields
    tallyGuid: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },
    tallyAlterId: {
      type: String,
      trim: true
    },
    tallySynced: {
      type: Boolean,
      default: false
    },
    lastTallySync: {
      type: Date
    },
    tallyMasterType: {
      type: String,
      enum: ['Ledger', 'Party'],
      default: 'Ledger'
    }
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
