import mongoose from 'mongoose';

const grnSchema = new mongoose.Schema({
  grnId: {
    type: String,
    unique: true,
    required: true
  },
  poId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'PurchaseOrder',
    required: true
  },
  vendorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Vendor',
    required: true
  },
  orderedQuantity: {
    type: Number,
    required: true
  },
  receivedQuantity: {
    type: Number,
    required: true
  },
  status: {
    type: String,
    enum: ['Completed', 'Partial', 'Pending'],
    default: 'Pending'
  },
  receivedDate: {
    type: Date,
    default: Date.now
  },
  remarks: String,
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

export default mongoose.model('GRN', grnSchema);
