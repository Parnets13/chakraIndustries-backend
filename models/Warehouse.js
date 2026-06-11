import mongoose from 'mongoose';

const warehouseSchema = new mongoose.Schema({
  warehouseId: { type: String, required: true, unique: true },
  name:        { type: String, required: true },
  city:        { type: String, default: '' },
  state:       { type: String, default: '' },
  pincode:     { type: String, default: '' },
  location:    { type: String, required: true },
  manager:     { type: String, default: '' },
  capacity:    { type: Number, default: 0 },
  phone:       { type: String, default: '', match: [/^(\d{10})?$/, 'Phone must be exactly 10 digits'] },
  address:     { type: String, default: '' },
  type:        { type: String, default: 'Raw Material' },
  status:      { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

export default mongoose.model('Warehouse', warehouseSchema);
