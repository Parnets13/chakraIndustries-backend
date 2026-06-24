import mongoose from 'mongoose';

const pickingListSchema = new mongoose.Schema({
  pickId: {
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
  items: [{
    inventory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Inventory'
    },
    sku: String,
    itemName: String,
    quantity: Number,
    location: String,
    picked: {
      type: Boolean,
      default: false
    }
  }],
  picker: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['Pending', 'In Progress', 'Completed', 'Cancelled'],
    default: 'Pending'
  }
}, {
  timestamps: true
});

export default mongoose.model('PickingList', pickingListSchema);
