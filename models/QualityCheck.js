import mongoose from 'mongoose';

const qcItemSchema = new mongoose.Schema({
  itemName:     { type: String, required: true },
  receivedQty:  { type: Number, required: true },
  passedQty:    { type: Number, default: 0 },
  failedQty:    { type: Number, default: 0 },
  remarks:      { type: String, default: '' },
}, { _id: false });

const qualityCheckSchema = new mongoose.Schema({
  qcId:     { type: String, unique: true, required: true },
  grnId:    { type: mongoose.Schema.Types.ObjectId, ref: 'GRN', required: true },
  poId:     { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  items:    [qcItemSchema],
  status: {
    type: String,
    enum: ['Pending', 'Passed', 'Partial', 'Rejected'],
    default: 'Pending',
  },
  inspectedBy: { type: String, default: '' },
  inspectedAt: { type: Date },
  remarks:     { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('QualityCheck', qualityCheckSchema);
