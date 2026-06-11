import mongoose from 'mongoose';

const deliveryScheduleSchema = new mongoose.Schema(
  {
    scheduleId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    quotationId: {
      type: String,
      required: [true, 'Quotation ID is required']
    },
    orderId: {
      type: String,
      index: true
    },
    clientId: {
      type: String,
      index: true
    },
    client: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true
    },
    clientTier: {
      type: String,
      enum: ['Silver', 'Gold', 'Platinum']
    },
    items: [{
      sku: String,
      itemName: String,
      qty: Number,
      unitPrice: Number,
      total: Number
    }],
    totalItems: {
      type: Number,
      default: 0
    },
    totalQty: {
      type: Number,
      default: 0
    },
    deliveryDate: {
      type: Date,
      required: [true, 'Delivery date is required']
    },
    slot: {
      type: String,
      default: 'Morning'
    },
    warehouse: {
      type: String,
      default: 'WH-01'
    },
    vehicle: {
      type: String,
      default: 'Pending'
    },
    status: {
      type: String,
      enum: ['Draft', 'Pending', 'Confirmed', 'Dispatched', 'Delivered'],
      default: 'Draft'
    },
    podSignature: String,
    podPhoto: String,
    deliveredAt: Date,
    notes: String
  },
  {
    timestamps: true
  }
);

export default mongoose.models.DeliverySchedule || mongoose.model('DeliverySchedule', deliveryScheduleSchema);
