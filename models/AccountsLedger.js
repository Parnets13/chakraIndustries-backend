import mongoose from 'mongoose';

const accountsLedgerSchema = new mongoose.Schema({
  // Reference to corporate client
  corporateClientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CorporateClient',
    required: false,
    index: true
  },
  
  // Ledger identification
  ledgerCode: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  ledgerName: {
    type: String,
    required: true,
    index: true
  },
  
  // Ledger classification
  ledgerGroup: {
    type: String,
    enum: ['Sundry Debtors', 'Sundry Creditors', 'Cash', 'Bank'],
    default: 'Sundry Debtors'
  },
  
  ledgerType: {
    type: String,
    enum: ['Customer', 'Vendor', 'Bank', 'Cash', 'Expense', 'Income'],
    default: 'Customer'
  },
  
  // GST and tax details
  gstNumber: {
    type: String,
    required: false,   // must be false — Tally ledgers imported without a GSTIN are valid
    index: true,
    default: 'N/A'
  },
  
  panNumber: {
    type: String,
    required: false
  },
  
  gstRegistrationType: {
    type: String,
    enum: ['Regular', 'Composition', 'Unregistered', 'SEZ'],
    default: 'Regular'
  },
  
  // Address for ledger
  address: {
    street: String,
    area: String,
    city: String,
    state: String,
    pincode: String,
    country: { type: String, default: 'India' }
  },
  
  // Contact details
  contactPerson: {
    type: String,
    required: false
  },
  
  phone: {
    type: String,
    required: false
  },
  
  email: {
    type: String,
    required: false
  },
  
  // Financial details
  creditLimit: {
    type: Number,
    default: 0
  },
  
  openingBalance: {
    type: Number,
    default: 0
  },
  
  currentBalance: {
    type: Number,
    default: 0
  },
  
  balanceType: {
    type: String,
    enum: ['Dr', 'Cr'],
    default: 'Dr'
  },
  
  // Payment terms
  paymentTerms: {
    type: String,
    enum: ['Immediate', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
    default: 'Net 30'
  },
  
  interestRate: {
    type: Number,
    default: 0
  },
  
  // Bank details for payments
  bankDetails: {
    accountNumber: String,
    ifscCode: String,
    bankName: String,
    branch: String,
    accountType: { type: String, enum: ['Savings', 'Current', 'CC', 'OD'] }
  },
  
  // Ledger settings
  ledgerSettings: {
    billWise: { type: Boolean, default: true },
    costCentre: { type: Boolean, default: false },
    interestCalculation: { type: Boolean, default: false },
    tdsApplicable: { type: Boolean, default: false },
    tdsPercentage: { type: Number, default: 0 }
  },
  
  // Tally integration
  tallyLedgerId: {
    type: String,
    index: true
  },

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
  
  // Status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Sync status
  syncedWithTally: {
    type: Boolean,
    default: false
  },
  
  lastTallySync: {
    type: Date
  },
  
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
accountsLedgerSchema.index({ corporateClientId: 1, isActive: 1 });
accountsLedgerSchema.index({ ledgerCode: 1, isActive: 1 });
accountsLedgerSchema.index({ gstNumber: 1 });
accountsLedgerSchema.index({ tallyLedgerId: 1 });
accountsLedgerSchema.index({ tallyGuid: 1 }, { sparse: true });

// Methods for balance calculations
accountsLedgerSchema.methods.updateBalance = function(amount, type = 'Dr') {
  if (type === 'Dr') {
    this.currentBalance += amount;
  } else {
    this.currentBalance -= amount;
  }
  this.balanceType = this.currentBalance >= 0 ? 'Dr' : 'Cr';
  return this.save();
};

accountsLedgerSchema.methods.checkCreditLimit = function() {
  return this.currentBalance <= this.creditLimit;
};

export default mongoose.model('AccountsLedger', accountsLedgerSchema);