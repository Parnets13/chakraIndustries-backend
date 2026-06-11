import mongoose from 'mongoose';

const bulkOrderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    quotationId: {
      type: String,
      required: [true, 'Quotation ID is required'],
      index: true
    },
    clientId: {
      type: String,
      required: [true, 'Client ID is required'],
      index: true
    },
    clientName: String,
    clientTier: {
      type: String,
      enum: ['Silver', 'Gold', 'Platinum']
    },
    items: [{
      sku: String,
      itemName: String,
      qty: Number,
      unitPrice: Number,
      discount: Number,
      total: Number
    }],
    packaging: {
      type: String,
      default: 'Standard Box'
    },
    packagingCost: {
      type: Number,
      default: 0
    },
    subtotal: Number,
    gst: Number,
    grandTotal: Number,
    paymentTerms: String,
    deliveryDate: Date,
    status: {
      type: String,
      enum: ['Draft', 'Approved', 'Inventory Check', 'Production', 'Ready', 'Dispatched', 'Delivered', 'Cancelled'],
      default: 'Draft'
    },
    approvalStatus: {
      type: String,
      enum: ['Pending', 'Approved', 'Rejected'],
      default: 'Pending'
    },
    inventoryStatus: {
      type: String,
      enum: ['Not Checked', 'In Stock', 'Partial Stock', 'Out of Stock'],
      default: 'Not Checked'
    },
    workOrderId: String,
    invoiceId: String,
    deliveryScheduleId: String,
    creditCheckPassed: {
      type: Boolean,
      default: false
    },
    creditCheckDetails: {
      availableCredit: Number,
      usedCredit: Number,
      requiredCredit: Number,
      passed: Boolean
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  },
  { timestamps: true }
);

export default mongoose.models.BulkOrder || mongoose.model('BulkOrder', bulkOrderSchema);
