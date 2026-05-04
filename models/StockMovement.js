import mongoose from 'mongoose';

const stockMovementSchema = new mongoose.Schema({
  movementId: { type: String, required: true, unique: true },
  type:       { type: String, enum: ['Inward', 'Outward', 'Transfer'], required: true },
  sku:        { type: String, required: true },
  name:       { type: String, default: '' },
  qty:        { type: Number, required: true },
  from:       { type: String, required: true },
  to:         { type: String, required: true },
  ref:        { type: String, default: '' },
  notes:      { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('StockMovement', stockMovementSchema);
