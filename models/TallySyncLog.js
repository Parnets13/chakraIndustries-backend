import mongoose from 'mongoose';

const tallySyncLogSchema = new mongoose.Schema({
  syncId:    { type: String, required: true, unique: true },
  type:      { type: String, enum: ['Purchase','Sales','Payment','Receipt','Journal','Contra','Ledger','Item Master','GST','Full','Units','Godowns','GST Rates'], required: true },
  entity:    { type: String, default: '' },
  direction: { type: String, enum: ['ERP → Tally','Tally → ERP'], default: 'ERP → Tally' },
  status:    { type: String, enum: ['Success','Failed','Partial'], default: 'Success' },
  duration:  { type: String, default: '' },
  error:     { type: String, default: '' },
  records:   { type: Number, default: 0 },
  triggeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

tallySyncLogSchema.index({ status: 1 });
tallySyncLogSchema.index({ type: 1 });
tallySyncLogSchema.index({ createdAt: -1 });

export default mongoose.model('TallySyncLog', tallySyncLogSchema);
