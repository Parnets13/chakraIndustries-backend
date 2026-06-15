import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true
  },
  year: {
    type: Number,
    required: true
  },
  sequence: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

counterSchema.index({ name: 1, year: 1 }, { unique: true });

export default mongoose.model('Counter', counterSchema);
