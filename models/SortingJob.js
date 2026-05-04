import mongoose from 'mongoose';

const sortingJobSchema = new mongoose.Schema({
  sortId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  orderId: {
    type: String,
    required: true
  },
  sku: String,
  itemName: String,
  quantity: Number,
  grade: {
    type: String,
    enum: ['Grade A', 'Grade B', 'Grade C'],
    default: 'Grade A'
  },
  status: {
    type: String,
    enum: ['Pending', 'Sorted', 'Completed'],
    default: 'Pending'
  }
}, {
  timestamps: true
});

export default mongoose.model('SortingJob', sortingJobSchema);
