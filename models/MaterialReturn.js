import mongoose from 'mongoose';

const materialReturnSchema = new mongoose.Schema({
  mrId:       { type: String, unique: true, required: true },
  docketId:   { type: String, unique: true, required: true },
  poId:       { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  vendorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  supplierName: { type: String, required: true },
  items:      { type: Number, default: 1 },
  value:      { type: Number, default: 0 },
  reason:     { type: String, required: true },
  transport:  { type: String, default: '' },
  awbNo:      { type: String, default: '' },
  stage: {
    type: String,
    enum: ['Initiated', 'In-transit', 'Received', 'QC', 'Closed'],
    default: 'Initiated',
  },
  creditNoteId: { type: String, default: '' },
  debitNoteId:  { type: String, default: '' },
  stockReversed: { type: Boolean, default: false },
}, { timestamps: true });

export default mongoose.model('MaterialReturn', materialReturnSchema);
