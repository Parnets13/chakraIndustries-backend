import mongoose from 'mongoose';

const returnQcSchema = new mongoose.Schema({
  qcId:           { type: String, unique: true, required: true },
  returnId:       { type: String, ref: 'MaterialReturn', required: true },
  damagedQty:     { type: Number, default: 0 },
  reusableQty:    { type: Number, default: 0 },
  rejectedQty:    { type: Number, default: 0 },
  scrapQty:       { type: Number, default: 0 },
  status:         { type: String, enum: ['Pending QC', 'QC In Progress', 'QC Passed', 'QC Failed'], default: 'Pending QC' },
  inspectedBy:    { type: String },
  inspectedAt:    { type: Date },
  remarks:        { type: String }
}, { timestamps: true });

export default mongoose.model('ReturnQC', returnQcSchema);
