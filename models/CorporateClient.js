import mongoose from 'mongoose';

const corporateClientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true,
      index: true
    },
    contact: {
      type: String,
      required: [true, 'Contact person is required'],
      trim: true
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      match: [/^\d{10}$/, 'Phone must be exactly 10 digits'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      lowercase: true,
      trim: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    state: {
      type: String,
      trim: true
    },
    pincode: {
      type: String,
      match: [/^\d{6}$/, 'Pincode must be exactly 6 digits']
    },
    tier: {
      type: String,
      enum: ['Silver', 'Gold', 'Platinum'],
      required: [true, 'Tier is required']
    },
    creditLimit: {
      type: Number,
      default: 0,
      min: [0, 'Credit limit cannot be negative']
    },
    outstanding: {
      type: Number,
      default: 0
    },
    availableCredit: {
      type: Number,
      default: function() { return this.creditLimit - this.outstanding; }
    },
    gstNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GST number format']
    },
    panNumber: {
      type: String,
      trim: true,
      uppercase: true,
      match: [/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/, 'Invalid PAN number format']
    },
    address: {
      street: { type: String, trim: true },
      area: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, match: [/^\d{6}$/, 'Invalid pincode'] },
      country: { type: String, default: 'India', trim: true }
    },
    billingAddress: {
      street: { type: String, trim: true },
      area: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, match: [/^\d{6}$/, 'Invalid pincode'] },
      country: { type: String, default: 'India', trim: true }
    },
    shippingAddress: {
      street: { type: String, trim: true },
      area: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      pincode: { type: String, match: [/^\d{6}$/, 'Invalid pincode'] },
      country: { type: String, default: 'India', trim: true }
    },
    paymentTerms: {
      type: String,
      enum: ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
      default: 'Net 30'
    },
    discountPercentage: {
      type: Number,
      default: 0,
      min: [0, 'Discount cannot be negative'],
      max: [100, 'Discount cannot exceed 100%']
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Suspended', 'Blacklisted'],
      default: 'Active'
    },
    // Dynamic Data Flow Integration
    tallyLedgerId: {
      type: String,
      trim: true
    },
    tallySync: {
      synced: { type: Boolean, default: false },
      lastSyncAt: { type: Date },
      syncStatus: { type: String, enum: ['Pending', 'Success', 'Failed'], default: 'Pending' },
      syncError: { type: String }
    },
    // Business Intelligence
    totalOrders: { type: Number, default: 0 },
    totalOrderValue: { type: Number, default: 0 },
    lastOrderDate: { type: Date },
    averageOrderValue: { type: Number, default: 0 },
    // Compliance & Documentation
    documents: [{
      type: { type: String, enum: ['GST Certificate', 'PAN Card', 'Trade License', 'Other'] },
      fileName: String,
      filePath: String,
      uploadedAt: { type: Date, default: Date.now }
    }],
    // Audit Trail
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Integration Status
    integrationStatus: {
      quotation: { type: Boolean, default: false },
      invoice: { type: Boolean, default: false },
      accounts: { type: Boolean, default: false },
      dispatch: { type: Boolean, default: false },
      tally: { type: Boolean, default: false }
    }
  },
  {
    timestamps: true
  }
);

// Pre-save middleware to calculate available credit
corporateClientSchema.pre('save', function(next) {
  this.availableCredit = this.creditLimit - this.outstanding;
  next();
});

// Pre-save middleware to sync billing address if not provided
corporateClientSchema.pre('save', function(next) {
  if (!this.billingAddress.street && this.address.street) {
    this.billingAddress = { ...this.address };
  }
  if (!this.shippingAddress.street && this.address.street) {
    this.shippingAddress = { ...this.address };
  }
  next();
});

// Instance method to update business metrics
corporateClientSchema.methods.updateBusinessMetrics = function(orderValue) {
  this.totalOrders += 1;
  this.totalOrderValue += orderValue;
  this.lastOrderDate = new Date();
  this.averageOrderValue = this.totalOrderValue / this.totalOrders;
  return this.save();
};

// Instance method to check credit availability
corporateClientSchema.methods.checkCreditAvailability = function(amount) {
  return this.availableCredit >= amount;
};

// Static method to get clients by tier
corporateClientSchema.statics.getByTier = function(tier) {
  return this.find({ tier, status: 'Active' });
};

// Static method to get clients needing Tally sync
corporateClientSchema.statics.getPendingTallySync = function() {
  return this.find({ 'tallySync.synced': false, status: 'Active' });
};

export default mongoose.models.CorporateClient || mongoose.model('CorporateClient', corporateClientSchema);
