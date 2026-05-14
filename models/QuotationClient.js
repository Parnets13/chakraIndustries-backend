import mongoose from 'mongoose';

const quotationClientSchema = new mongoose.Schema({
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
  
  // Contact details for quotations
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
  
  // GST and billing details
  gstNumber: {
    type: String,
    required: true,
    index: true
  },
  
  panNumber: {
    type: String
  },
  
  // Address for quotations
  billingAddress: {
    street: String,
    area: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  
  shippingAddress: {
    street: String,
    area: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  
  // Business terms for quotations
  paymentTerms: {
    type: String,
    enum: ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
    default: 'Net 30'
  },
  
  creditLimit: {
    type: Number,
    default: 0
  },
  
  discountPercentage: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  
  tier: {
    type: String,
    enum: ['Silver', 'Gold', 'Platinum'],
    required: true
  },
  
  // Quotation preferences
  preferredCurrency: {
    type: String,
    default: 'INR'
  },
  
  taxType: {
    type: String,
    enum: ['IGST', 'CGST+SGST', 'Exempt'],
    default: 'CGST+SGST'
  },
  
  // Status
  isActive: {
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
quotationClientSchema.index({ corporateClientId: 1, isActive: 1 });
quotationClientSchema.index({ clientCode: 1, isActive: 1 });
quotationClientSchema.index({ gstNumber: 1 });

export default mongoose.model('QuotationClient', quotationClientSchema);