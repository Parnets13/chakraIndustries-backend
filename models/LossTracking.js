import mongoose from 'mongoose';

const lossTrackingSchema = new mongoose.Schema({
  // Auto-generated fields
  lossId: {
    type: String,
    required: true,
    unique: true,
    default: function() {
      return `LOSS-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
    }
  },
  
  // Linked IDs (Auto from other modules)
  mrId: {
    type: String,
    required: true,
    ref: 'MaterialReturn'
  },
  docketId: {
    type: String,
    ref: 'DocketTracking'
  },
  returnRequestId: {
    type: String,
    ref: 'ReturnRequest'
  },
  
  // Supplier & Customer Info (Auto from masters)
  supplierName: {
    type: String,
    required: true
  },
  supplierId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor'
  },
  customerName: {
    type: String
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Client'
  },
  
  // Invoice Details (Auto from Invoice Module)
  invoiceNumber: {
    type: String,
    required: true
  },
  invoiceDate: {
    type: Date,
    required: true
  },
  invoiceType: {
    type: String,
    enum: ['Purchase', 'Sales'],
    required: true
  },
  
  // Product Details (Auto from Invoice/GRN)
  products: [{
    productName: {
      type: String,
      required: true
    },
    skuCode: {
      type: String,
      required: true
    },
    batchNo: String,
    serialNo: String,
    returnQty: {
      type: Number,
      default: 0
    },
    receivedQty: {
      type: Number,
      default: 0
    },
    damagedQty: {
      type: Number,
      default: 0
    },
    shortageQty: {
      type: Number,
      default: 0
    },
    excessQty: {
      type: Number,
      default: 0
    },
    unitRate: {
      type: Number,
      default: 0
    },
    totalValue: {
      type: Number,
      default: 0
    }
  }],
  
  // Loss Classification (Manual)
  lossType: {
    type: String,
    required: true
  },
  
  rootCause: {
    type: String,
    required: true
  },
  
  // Financial Details
  lossAmount: {
    type: Number,
    required: true,
    min: 0
  },
  recoverableAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  nonRecoverableAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Finance Integration (Auto)
  debitNoteNumber: String,
  creditNoteNumber: String,
  financialStatus: {
    type: String,
    default: 'Pending'
  },
  
  // Material Status (Auto from Warehouse)
  materialStatus: {
    type: String,
    default: 'Pending Return'
  },
  
  // Reconciliation Status (Auto)
  reconciliationStatus: {
    type: String,
    enum: ['Open', 'Material Closed', 'Finance Closed', 'Fully Reconciled'],
    default: 'Open'
  },
  
  // Responsibility & Priority (Manual)
  responsibleDepartment: {
    type: String,
    required: true
  },
  responsiblePerson: {
    type: String,
    required: true
  },
  priority: {
    type: String,
    required: true,
    enum: ['Low', 'Medium', 'High', 'Critical'],
    default: 'Medium'
  },
  
  // SLA & Tracking (Auto)
  slaDueDate: {
    type: Date,
    default: () => new Date(+new Date() + 7*24*60*60*1000) // Default 7 days
  },
  escalationLevel: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Resolution Details (Manual)
  resolutionNotes: String,
  correctiveAction: String,
  preventiveAction: String,
  
  // Attachments (Manual)
  attachments: [{
    filename: String,
    path: String,
    uploadedBy: String,
    uploadedAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Closure Details (Auto)
  closedBy: String,
  closureDate: Date,
  finalStatus: {
    type: String,
    default: 'Open'
  },
  
  // Audit Trail
  createdBy: {
    type: String,
    required: true
  },
  lastUpdatedBy: String,
  
  // Activity Log
  activityLog: [{
    action: String,
    performedBy: String,
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: String
  }]
}, {
  timestamps: true
});

// Virtual for days open calculation
lossTrackingSchema.virtual('daysOpen').get(function() {
  const endDate = this.closureDate || new Date();
  const diffTime = Math.abs(endDate - this.createdAt);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
});

// Virtual for SLA status
lossTrackingSchema.virtual('slaStatus').get(function() {
  if (this.finalStatus === 'Closed') return 'Completed';
  const now = new Date();
  const daysUntilDue = Math.ceil((this.slaDueDate - now) / (1000 * 60 * 60 * 24));
  if (daysUntilDue < 0) return 'Overdue';
  if (daysUntilDue <= 2) return 'Due Soon';
  return 'On Track';
});

// Auto-calculate SLA due date based on priority
lossTrackingSchema.pre('save', function(next) {
  if (this.isNew && !this.slaDueDate) {
    const slaHours = {
      'Critical': 24,
      'High': 72,
      'Medium': 168, // 7 days
      'Low': 336     // 14 days
    };
    
    const hours = slaHours[this.priority] || 168;
    this.slaDueDate = new Date(Date.now() + (hours * 60 * 60 * 1000));
  }
  
  // Auto-calculate non-recoverable amount
  this.nonRecoverableAmount = this.lossAmount - this.recoverableAmount;
  
  // Update reconciliation status
  this.updateReconciliationStatus();
  
  next();
});

// Method to update reconciliation status
lossTrackingSchema.methods.updateReconciliationStatus = function() {
  const materialClosed = ['QC Completed', 'Disposed'].includes(this.materialStatus);
  const financeClosed = ['Settled', 'Write-off'].includes(this.financialStatus);
  
  if (materialClosed && financeClosed) {
    this.reconciliationStatus = 'Fully Reconciled';
    this.finalStatus = 'Closed';
  } else if (materialClosed) {
    this.reconciliationStatus = 'Material Closed';
  } else if (financeClosed) {
    this.reconciliationStatus = 'Finance Closed';
  } else {
    this.reconciliationStatus = 'Open';
  }
};

// Method to add activity log
lossTrackingSchema.methods.addActivity = function(action, performedBy, details = '') {
  this.activityLog.push({
    action,
    performedBy,
    details,
    timestamp: new Date()
  });
};

// Indexes for efficient queries
lossTrackingSchema.index({ lossId: 1 });
lossTrackingSchema.index({ mrId: 1 });
lossTrackingSchema.index({ supplierName: 1 });
lossTrackingSchema.index({ lossType: 1 });
lossTrackingSchema.index({ finalStatus: 1 });
lossTrackingSchema.index({ priority: 1 });
lossTrackingSchema.index({ reconciliationStatus: 1 });
lossTrackingSchema.index({ slaDueDate: 1 });
lossTrackingSchema.index({ createdAt: -1 });

export default mongoose.model('LossTracking', lossTrackingSchema);