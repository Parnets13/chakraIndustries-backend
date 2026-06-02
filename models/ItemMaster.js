import mongoose from 'mongoose';

const itemMasterSchema = new mongoose.Schema({
  // Item Identification
  itemId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  sku: {
    type: String,
    required: true,
    unique: true,
    uppercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  description: {
    type: String,
    default: ''
  },
  
  // Classification
  category: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category'
  },
  unit: {
    type: String,
    required: true,
    default: 'units',
    enum: ['units', 'kg', 'liter', 'meter', 'box', 'pack', 'piece', 'dozen']
  },
  
  // Pricing & Costing
  unitPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  costPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  sellingPrice: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Inventory Control
  minQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  maxQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  reorderPoint: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // Status & Tracking
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Discontinued'],
    default: 'Active'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Additional Info
  hsn: {
    type: String,
    default: ''
  },
  gst: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  barcode: {
    type: String,
    default: '',
    trim: true,
    // sparse unique: allows multiple empty strings but enforces uniqueness for non-empty values
    index: { unique: true, sparse: true },
  },
  
  // Metadata
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
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
  tallyStockName: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Indexes for fast lookups
itemMasterSchema.index({ sku: 1 });
itemMasterSchema.index({ itemId: 1 });
itemMasterSchema.index({ name: 1 });
itemMasterSchema.index({ category: 1 });
itemMasterSchema.index({ status: 1 });
itemMasterSchema.index({ isActive: 1 });

export default mongoose.model('ItemMaster', itemMasterSchema);
