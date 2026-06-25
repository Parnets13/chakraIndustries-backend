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
    enum: ['units', 'kg', 'g', 'mg', 'liter', 'litre', 'ml', 'meter', 'metre', 'cm', 'box', 'pack', 'set', 'piece', 'dozen', 'Nos', 'Set', 'Pcs', 'Kg', 'Ltr', 'Mtr', 'Box', 'Gm', 'Ml']
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
    default: undefined,
    trim: true,
    // sparse unique: allows multiple null values but enforces uniqueness for non-null values
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
    unique: true,
    sparse: true
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
  },
  // Tally stock balance fields
  openingStock: {
    type: Number,
    default: 0
  },
  openingValue: {
    type: Number,
    default: 0
  },
  closingBalance: {
    type: String,
    default: '0'
  },
  closingValue: {
    type: String,
    default: '0'
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
