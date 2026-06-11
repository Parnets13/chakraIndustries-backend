import mongoose from 'mongoose';

const verificationSchema = new mongoose.Schema({
  verificationId: { type: String, unique: true, required: true },
  returnId:       { type: String, ref: 'MaterialReturn', required: true },
  expectedQty:    { type: Number, required: true },
  receivedQty:    { type: Number, required: true },
  mismatchFound:  { type: Boolean, default: false },
  mismatchQty:    { type: Number, default: 0 },
  verifiedBy:     { type: String },
  verifiedAt:     { type: Date, default: Date.now },
  remarks:        { type: String }
}, { timestamps: true });

export default mongoose.model('WarehouseVerification', verificationSchema);
