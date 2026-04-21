import mongoose from 'mongoose';

const rfqSchema = new mongoose.Schema(
  {
    rfqId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    title: {
      type: String,
      required: [true, 'Title is required'],
      trim: true
    },
    linkedPR: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PurchaseRequisition',
      default: null
    },
    vendors: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true
    }],
    items: [{
      name: {
        type: String,
        required: true,
        trim: true
      },
      qty: {
        type: Number,
        required: true,
        min: 0
      },
      unit: {
        type: String,
        required: true,
        default: 'Nos'
      }
    }],
    dueDate: {
      type: Date,
      required: [true, 'Due date is required']
    },
    priority: {
      type: String,
      enum: ['Normal', 'Urgent', 'Critical'],
      default: 'Normal'
    },
    status: {
      type: String,
      enum: ['Draft', 'Sent', 'Quoted', 'Closed', 'Cancelled'],
      default: 'Sent'
    },
    quotations: [{
      vendor: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
      },
      items: [{
        name: String,
        qty: Number,
        unit: String,
        unitPrice: Number,
        totalPrice: Number
      }],
      totalAmount: Number,
      validUntil: Date,
      remarks: String,
      submittedAt: {
        type: Date,
        default: Date.now
      }
    }],
    createdBy: {
      type: String,
      required: true
    },
    remarks: String
  },
  {
    timestamps: true
  }
);

export default mongoose.model('RFQ', rfqSchema);
