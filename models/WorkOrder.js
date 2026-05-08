import mongoose from 'mongoose';

const workOrderSchema = new mongoose.Schema({
  woId:       { type: String, required: true, unique: true, index: true },
  product:    { type: String, required: true, trim: true },
  bomId:      { type: mongoose.Schema.Types.ObjectId, ref: 'BOM', default: null },
  oemBrand:   { type: mongoose.Schema.Types.ObjectId, ref: 'OEMBrand', default: null },
  oemProduct: { type: mongoose.Schema.Types.ObjectId, ref: 'OEMProduct', default: null },
  qty:        { type: Number, required: true, min: 1 },
  produced:   { type: Number, default: 0 },
  shift:      { type: String, enum: ['Morning', 'General', 'Night'], default: 'General' },
  priority:   { type: String, enum: ['Normal', 'High', 'Urgent'], default: 'Normal' },
  startDate:  { type: Date },
  endDate:    { type: Date },
  status:     { type: String, enum: ['Pending', 'In-Progress', 'Completed', 'Cancelled'], default: 'Pending' },
  remarks:    { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('WorkOrder', workOrderSchema);
