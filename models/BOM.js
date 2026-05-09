import mongoose from 'mongoose';

const bomSchema = new mongoose.Schema({
  projectId: {
    type: String,
    required: true,
    unique: true
  },
  product: {
    type: String,
    required: true
  },
  version: {
    type: String,
    default: 'v1.0'
  },
  type: {
    type: String,
    enum: ['Finished Good', 'Sub-Assembly', 'Semi-Finished'],
    default: 'Finished Good'
  },
  uom: {
    type: String,
    default: 'Set'
  },
  description: String,
  
  // Enhanced materials structure with inventory integration
  materials: [{
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ItemMaster',
      required: true
    },
    materialName: String,
    sku: String,
    quantity: {
      type: Number,
      required: true,
      min: 0
    },
    unit: {
      type: String,
      required: true
    },
    availableStock: {
      type: Number,
      default: 0
    },
    costPrice: Number,
    totalCost: Number,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Legacy components field (for backward compatibility)
  components: [{
    itemId: mongoose.Schema.Types.ObjectId,
    itemName: String,
    qty: Number,
    unit: String
  }],
  
  // BOM metadata
  totalMaterialCost: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Archived'],
    default: 'Active'
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

bomSchema.index({ product: 1 });
bomSchema.index({ projectId: 1 });
bomSchema.index({ status: 1 });
bomSchema.index({ 'materials.materialId': 1 });

// Calculate total material cost before saving
bomSchema.pre('save', function(next) {
  if (this.materials && this.materials.length > 0) {
    this.totalMaterialCost = this.materials.reduce((sum, mat) => {
      return sum + (mat.totalCost || 0);
    }, 0);
  }
  next();
});

export default mongoose.model('BOM', bomSchema);
