import mongoose from 'mongoose';

const quotationRequestItemSchema = new mongoose.Schema({
  // Reference to bulk quotation request
  requestId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'BulkQuotationRequest',
    required: true,
    index: true
  },
  
  // Item details
  itemCode: {
    type: String,
    required: false,   // auto-generated in pre-save
    index: true
  },
  
  itemName: {
    type: String,
    required: true
  },
  
  description: {
    type: String
  },
  
  // Quantity and units
  requestedQuantity: {
    type: Number,
    required: true,
    min: 1
  },
  
  unit: {
    type: String,
    enum: ['Pieces', 'Lakh', 'Crore', 'Kg', 'Tons', 'Meters', 'Liters'],
    default: 'Pieces'
  },
  
  // Specifications
  specifications: {
    material: String,
    dimensions: {
      length: Number,
      width: Number,
      height: Number,
      unit: { type: String, default: 'mm' }
    },
    weight: {
      value: Number,
      unit: { type: String, default: 'grams' }
    },
    color: String,
    finish: String,
    grade: String,
    customRequirements: String
  },
  
  // Pricing (filled during approval process)
  pricing: {
    estimatedCost: Number,
    materialCost: Number,
    laborCost: Number,
    overheadCost: Number,
    sellingPrice: Number,
    margin: Number,
    marginPercentage: Number
  },
  
  // Inventory status
  inventory: {
    currentStock: { type: Number, default: 0 },
    availableStock: { type: Number, default: 0 },
    reservedStock: { type: Number, default: 0 },
    shortfall: { type: Number, default: 0 },
    restockRequired: { type: Boolean, default: false },
    estimatedRestockDate: Date
  },
  
  // Production requirements
  production: {
    manufacturingRequired: { type: Boolean, default: false },
    bomId: { type: mongoose.Schema.Types.ObjectId, ref: 'BOM' },
    estimatedProductionTime: Number, // in hours
    productionComplexity: {
      type: String,
      enum: ['Simple', 'Medium', 'Complex', 'Custom'],
      default: 'Medium'
    },
    specialToolingRequired: { type: Boolean, default: false },
    qualityCheckRequired: { type: Boolean, default: true }
  },
  
  // Status tracking
  status: {
    type: String,
    enum: ['Pending', 'Approved', 'In Production', 'Quality Check', 'Ready', 'Delivered'],
    default: 'Pending'
  },
  
  // Workflow timestamps
  workflow: {
    approvedAt: Date,
    productionStarted: Date,
    productionCompleted: Date,
    qualityCheckStarted: Date,
    qualityCheckCompleted: Date,
    readyAt: Date,
    deliveredAt: Date
  },
  
  // Notes
  notes: String,
  productionNotes: String,
  qualityNotes: String,
  
  // Audit trail
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
}, {
  timestamps: true
});

// Indexes
quotationRequestItemSchema.index({ requestId: 1, status: 1 });
quotationRequestItemSchema.index({ itemCode: 1 });
quotationRequestItemSchema.index({ status: 1 });

// Pre-save middleware to generate item code
quotationRequestItemSchema.pre('save', async function(next) {
  if (this.isNew && !this.itemCode) {
    try {
      const request = await mongoose.model('BulkQuotationRequest').findById(this.requestId);
      if (request) {
        const itemCount = await this.constructor.countDocuments({ requestId: this.requestId });
        this.itemCode = `${request.requestId}-${String(itemCount + 1).padStart(2, '0')}`;
      } else {
        // fallback if request not found yet
        this.itemCode = `ITEM-${Date.now()}`;
      }
    } catch (_) {
      this.itemCode = `ITEM-${Date.now()}`;
    }
  }
  next();
});

// Instance methods
quotationRequestItemSchema.methods.updateStatus = function(newStatus, userId) {
  this.status = newStatus;
  this.updatedBy = userId;
  
  // Update workflow timestamps
  const now = new Date();
  switch (newStatus) {
    case 'Approved':
      this.workflow.approvedAt = now;
      break;
    case 'In Production':
      this.workflow.productionStarted = now;
      break;
    case 'Quality Check':
      this.workflow.productionCompleted = now;
      this.workflow.qualityCheckStarted = now;
      break;
    case 'Ready':
      this.workflow.qualityCheckCompleted = now;
      this.workflow.readyAt = now;
      break;
    case 'Delivered':
      this.workflow.deliveredAt = now;
      break;
  }
  
  return this.save();
};

quotationRequestItemSchema.methods.calculateMargin = function() {
  if (this.pricing.sellingPrice && this.pricing.estimatedCost) {
    this.pricing.margin = this.pricing.sellingPrice - this.pricing.estimatedCost;
    this.pricing.marginPercentage = (this.pricing.margin / this.pricing.sellingPrice) * 100;
  }
  return this.pricing;
};

quotationRequestItemSchema.methods.checkInventoryAvailability = function() {
  const available = this.inventory.availableStock;
  const required = this.requestedQuantity;
  
  if (available >= required) {
    this.inventory.shortfall = 0;
    this.inventory.restockRequired = false;
    return { status: 'Available', shortfall: 0 };
  } else {
    this.inventory.shortfall = required - available;
    this.inventory.restockRequired = true;
    return { status: 'Shortfall', shortfall: this.inventory.shortfall };
  }
};

// Static methods
quotationRequestItemSchema.statics.getByRequest = function(requestId) {
  return this.find({ requestId }).sort({ createdAt: 1 });
};

quotationRequestItemSchema.statics.getByStatus = function(status) {
  return this.find({ status }).populate('requestId', 'requestId clientName').sort({ createdAt: -1 });
};

quotationRequestItemSchema.statics.getPendingProduction = function() {
  return this.find({ 
    status: 'Approved',
    'production.manufacturingRequired': true 
  }).populate('requestId', 'requestId clientName deliveryDate');
};

export default mongoose.model('QuotationRequestItem', quotationRequestItemSchema);