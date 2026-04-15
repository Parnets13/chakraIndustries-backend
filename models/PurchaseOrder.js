import mongoose from 'mongoose';

const poItemSchema = new mongoose.Schema({
  itemName: {
    type: String,
    required: [true, 'Item name is required']
  },
  quantity: {
    type: Number,
    required: [true, 'Quantity is required'],
    min: [1, 'Quantity must be at least 1']
  },
  basePrice: {
    type: Number,
    required: [true, 'Base price is required'],
    min: [0, 'Price cannot be negative']
  },
  gstPercentage: {
    type: Number,
    default: 18
  },
  total: {
    type: Number,
    required: true
  }
}, { _id: false });

const purchaseOrderSchema = new mongoose.Schema(
  {
    poId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: [true, 'Vendor is required']
    },
    poDate: {
      type: Date,
      required: [true, 'PO date is required']
    },
    deliveryDate: {
      type: Date,
      required: [true, 'Delivery date is required']
    },
    items: {
      type: [poItemSchema],
      required: [true, 'At least one item is required'],
      validate: {
        validator: function(v) {
          return v.length > 0;
        },
        message: 'At least one item is required'
      }
    },
    
    subtotal: {
      type: Number,
      required: true,
      default: 0
    },
    gstTotal: {
      type: Number,
      required: true,
      default: 0
    },
    grandTotal: {
      type: Number,
      required: true,
      default: 0
    },
    
    status: {
      type: String,
      enum: ['Pending', 'Approved', 'Received', 'Cancelled'],
      default: 'Pending'
    },
    
    deliveryAddress: String,
    specialInstructions: String
  },
  {
    timestamps: true
  }
);

export default mongoose.model('PurchaseOrder', purchaseOrderSchema);
