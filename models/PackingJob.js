import mongoose from 'mongoose';

const packingJobSchema = new mongoose.Schema({
  packId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  orderId: {
    type: String,
    required: true
  },
  salesOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SalesOrder'
  },
  items: Number,
  weight: String,
  boxType: {
    type: String,
    enum: ['Standard Box', 'Large Box', 'Small Box', 'Custom'],
    default: 'Standard Box'
  },
  status: {
    type: String,
    enum: ['Pending', 'Packed', 'Completed'],
    default: 'Pending'
  }
}, {
  timestamps: true
});

export default mongoose.model('PackingJob', packingJobSchema);
