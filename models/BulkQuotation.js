import mongoose from 'mongoose';

const bulkQuotationSchema = new mongoose.Schema(
  {
    quotationId: {
      type: String,
      unique: true,
      sparse: true,
      required: true,
      index: true
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
    value: {
      type: Number,
      required: [true, 'Value is required']
    },
    packaging: {
      type: String,
      enum: ['Standard Box', 'Custom Branded', 'Bulk Loose', 'Premium Gift Box'],
      required: [true, 'Packaging option is required']
    },
    validity: {
      type: Date,
      required: [true, 'Validity date is required']
    },
    status: {
      type: String,
      enum: ['Draft', 'Sent', 'Approved', 'Expired'],
      default: 'Draft'
    },
    lineItems: [{
      item: String,
      sku: String,
      qty: Number,
      unitPrice: Number,
      discount: Number,
      total: Number
    }]
  },
  {
    timestamps: true
  }
);

export default mongoose.models.BulkQuotation || mongoose.model('BulkQuotation', bulkQuotationSchema);
