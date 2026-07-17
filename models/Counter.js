import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  year:     { type: Number, required: true },
  sequence: { type: Number, default: 0 },
}, { timestamps: true });

// Compound unique index — (name + year) uniquely identifies each counter
counterSchema.index({ name: 1, year: 1 }, { unique: true });

export default mongoose.model('Counter', counterSchema);
