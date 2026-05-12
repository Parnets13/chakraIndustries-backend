import mongoose from 'mongoose';

const packagingSchema = new mongoose.Schema({
  packagingId: {
    type: String,
    unique: true,
    required: true,
    index: true
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
  type: {
    type: String,
    enum: ['Standard', 'Custom', 'Bulk', 'Premium'],
    default: 'Standard'
  },
  moq: {
    type: Number,
    default: 100,
    min: 1
  },
  extraCost: {
    type: String,
    default: '₹0'
  },
  extraCostValue: {
    type: Number,
    default: 0
  },
  leadTime: {
    type: String,
    default: '0 days'
  },
  leadTimeDays: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive'],
    default: 'Active'
  },
  createdBy: {
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

packagingSchema.index({ packagingId: 1 });
packagingSchema.index({ status: 1 });
packagingSchema.index({ type: 1 });

export default mongoose.model('Packaging', packagingSchema);
