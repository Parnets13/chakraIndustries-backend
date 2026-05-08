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
    client: {
      type: String,
      required: [true, 'Client name is required'],
      trim: true
    },
    items: {
      type: Number,
      required: [true, 'Number of items is required']
    },
    qty: {
      type: Number,
      required: [true, 'Quantity is required']
    },
    deliveryDate: {
      type: Date,
      required: [true, 'Delivery date is required']
    },
    slot: {
      type: String,
      required: [true, 'Time slot is required']
    },
    warehouse: {
      type: String,
      required: [true, 'Warehouse is required']
    },
    vehicle: {
      type: String,
      default: 'Pending'
    },
    status: {
      type: String,
      enum: ['Draft', 'Pending', 'Confirmed', 'Delivered'],
      default: 'Draft'
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.models.DeliverySchedule || mongoose.model('DeliverySchedule', deliveryScheduleSchema);
