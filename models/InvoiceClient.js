import mongoose from 'mongoose';

const invoiceClientSchema = new mongoose.Schema({
  // Reference to corporate client
  corporateClientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CorporateClient',
    required: true,
    index: true
  },
  
  // Client identification
  clientCode: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  clientName: {
    type: String,
    required: true,
    index: true
  },
  
  // GST and tax details - CRITICAL for billing
  gstNumber: {
    type: String,
    required: true,
    index: true
  },
  
  panNumber: {
    type: String,
    required: true
  },
  
  gstType: {
    type: String,
    enum: ['Regular', 'Composition', 'Unregistered', 'SEZ'],
    default: 'Regular'
  },
  
  // Billing address - CRITICAL for GST compliance
  billingAddress: {
    street: { type: String, required: true },
    area: String,
    city: { type: String, required: true },
    state: { type: String, required: true },
    pincode: { type: String, required: true },
    country: { type: String, default: 'India' },
    stateCode: String // For GST state code
  },
  
  // Shipping address
  shippingAddress: {
    street: String,
    area: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' },
    stateCode: String
  },
  
  // Contact details for invoicing
  contactPerson: {
    type: String,
    required: true
  },
  
  phone: {
    type: String,
    required: true
  },
  
  email: {
    type: String,
    required: true
  },
  
  // Financial details
  creditLimit: {
    type: Number,
    default: 0
  },
  
  outstanding: {
    type: Number,
    default: 0
  },
  
  paymentTerms: {
    type: String,
    enum: ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
    default: 'Net 30'
  },
  
  // Tax preferences
  taxPreferences: {
    applyTDS: { type: Boolean, default: false },
    tdsPercentage: { type: Number, default: 0 },
    exemptFromTax: { type: Boolean, default: false },
    reverseCharge: { type: Boolean, default: false }
  },
  
  // Invoice settings
  invoiceSettings: {
    currency: { type: String, default: 'INR' },
    language: { type: String, default: 'English' },
    paymentMode: { type: String, enum: ['Cash', 'Cheque', 'NEFT', 'RTGS', 'UPI'], default: 'NEFT' },
    bankDetails: {
      accountNumber: String,
      ifscCode: String,
      bankName: String,
      branch: String
    }
  },
  
  // Tier and discount
  tier: {
    type: String,
    enum: ['Silver', 'Gold', 'Platinum'],
    required: true
  },
  
  discountPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Compliance flags
  gstCompliant: {
    type: Boolean,
    default: true
  },
  
  // Sync status
  syncedAt: {
    type: Date,
    default: Date.now
  },
  
  lastUpdatedFromCorporate: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Indexes for performance
invoiceClientSchema.index({ corporateClientId: 1, isActive: 1 });
invoiceClientSchema.index({ clientCode: 1, isActive: 1 });
invoiceClientSchema.index({ gstNumber: 1 });
invoiceClientSchema.index({ 'billingAddress.state': 1 });

export default mongoose.model('InvoiceClient', invoiceClientSchema);