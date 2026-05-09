import mongoose from 'mongoose';

const brandOrderSchema = new mongoose.Schema({
  brandOrderId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  corporateClientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CorporateClient',
    required: true
  },
  clientName: String,
  product: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: {
    type: String,
    default: 'Set'
  },
  orderDate: {
    type: Date,
    default: Date.now
  },
  deliveryDate: {
    type: Date,
    required: true
  },
  specifications: String,
  specialInstructions: String,
  status: {
    type: String,
    enum: ['Pending', 'Confirmed', 'In-Production', 'Completed', 'Delivered', 'Cancelled'],
    default: 'Pending'
  },
  approvalStatus: {
    type: String,
    enum: ['Pending', 'Approved', 'Rejected'],
    default: 'Pending'
  },
  estimatedCost: Number,
  actualCost: Number,
  paymentTerms: String,
  notes: String,
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  approvedBy: {
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

brandOrderSchema.index({ corporateClientId: 1 });
brandOrderSchema.index({ status: 1 });
brandOrderSchema.index({ approvalStatus: 1 });
brandOrderSchema.index({ orderDate: -1 });

export default mongoose.model('BrandOrder', brandOrderSchema);
