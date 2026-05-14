import mongoose from 'mongoose';

const bulkQuotationRequestSchema = new mongoose.Schema({
  // Request identification
  requestId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  
  // Client information
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CorporateClient',
    required: true,
    index: true
  },
  
  clientName: {
    type: String,
    required: true
  },
  
  // Request details
  requestDate: {
    type: Date,
    default: Date.now
  },
  
  deliveryDate: {
    type: Date,
    required: true
  },
  
  // Product requirements
  products: [{
    productName: {
      type: String,
      required: true
    },
    productType: {
      type: String,
      enum: ['Bottle', 'Container', 'Packaging', 'Custom'],
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    unit: {
      type: String,
      enum: ['Pieces', 'Lakh', 'Crore', 'Kg', 'Tons'],
      default: 'Pieces'
    },
    specifications: {
      material: String,
      size: String,
      color: String,
      finish: String,
      customRequirements: String
    }
  }],
  
  // Packaging requirements
  packaging: {
    type: {
      type: String,
      enum: ['Standard', 'Custom', 'Premium', 'Bulk'],
      required: true
    },
    customBranding: {
      type: Boolean,
      default: false
    },
    brandingDetails: {
      logoRequired: Boolean,
      colorScheme: String,
      specialInstructions: String
    }
  },
  
  // Business terms
  paymentTerms: {
    type: String,
    enum: ['Advance', 'Net 15', 'Net 30', 'Net 45', 'Net 60'],
    default: 'Net 30'
  },
  
  creditTerms: {
    creditRequired: { type: Boolean, default: false },
    creditAmount: { type: Number, default: 0 },
    creditPeriod: { type: Number, default: 30 }
  },
  
  // Request status and workflow
  status: {
    type: String,
    enum: ['Draft', 'Submitted', 'Under Review', 'Approved', 'Rejected', 'Quoted', 'Converted'],
    default: 'Draft'
  },
  
  // Workflow tracking
  workflow: {
    submittedAt: Date,
    reviewedAt: Date,
    approvedAt: Date,
    quotedAt: Date,
    convertedAt: Date
  },
  
  // Approval details
  approvalDetails: {
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvalNotes: String,
    priceApproval: {
      estimatedCost: Number,
      sellingPrice: Number,
      margin: Number,
      approved: { type: Boolean, default: false }
    }
  },
  
  // Inventory check results
  inventoryCheck: {
    checkedAt: Date,
    checkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    stockStatus: {
      type: String,
      enum: ['Available', 'Partial', 'Not Available', 'Pending Check'],
      default: 'Pending Check'
    },
    stockDetails: [{
      productName: String,
      requiredQty: Number,
      availableQty: Number,
      shortfall: Number,
      estimatedRestockDate: Date
    }]
  },
  
  // Production planning
  productionPlan: {
    plannedAt: Date,
    plannedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    manufacturingRequired: { type: Boolean, default: false },
    estimatedProductionTime: Number, // in days
    productionStartDate: Date,
    productionEndDate: Date,
    workOrderIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'WorkOrder' }]
  },
  
  // Notes and comments
  notes: String,
  internalNotes: String,
  
  // Attachments
  attachments: [{
    fileName: String,
    filePath: String,
    fileType: String,
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  
  // Audit trail
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Indexes for performance
bulkQuotationRequestSchema.index({ clientId: 1, status: 1 });
bulkQuotationRequestSchema.index({ requestDate: -1 });
bulkQuotationRequestSchema.index({ deliveryDate: 1 });
bulkQuotationRequestSchema.index({ status: 1, createdAt: -1 });

// Pre-save middleware to generate request ID
bulkQuotationRequestSchema.pre('save', async function(next) {
  if (this.isNew && !this.requestId) {
    const count = await this.constructor.countDocuments();
    this.requestId = `BQR-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

// Instance methods
bulkQuotationRequestSchema.methods.updateStatus = function(newStatus, userId) {
  this.status = newStatus;
  this.updatedBy = userId;
  
  // Update workflow timestamps
  const now = new Date();
  switch (newStatus) {
    case 'Submitted':
      this.workflow.submittedAt = now;
      break;
    case 'Under Review':
      this.workflow.reviewedAt = now;
      break;
    case 'Approved':
      this.workflow.approvedAt = now;
      break;
    case 'Quoted':
      this.workflow.quotedAt = now;
      break;
    case 'Converted':
      this.workflow.convertedAt = now;
      break;
  }
  
  return this.save();
};

bulkQuotationRequestSchema.methods.getTotalQuantity = function() {
  return this.products.reduce((total, product) => total + product.quantity, 0);
};

bulkQuotationRequestSchema.methods.getEstimatedValue = function() {
  return this.approvalDetails?.priceApproval?.sellingPrice || 0;
};

// Static methods
bulkQuotationRequestSchema.statics.getByStatus = function(status) {
  return this.find({ status }).populate('clientId', 'name tier').sort({ createdAt: -1 });
};

bulkQuotationRequestSchema.statics.getPendingApproval = function() {
  return this.find({ status: 'Under Review' }).populate('clientId', 'name tier').sort({ createdAt: -1 });
};

bulkQuotationRequestSchema.statics.getByClient = function(clientId) {
  return this.find({ clientId }).sort({ createdAt: -1 });
};

export default mongoose.model('BulkQuotationRequest', bulkQuotationRequestSchema);