import mongoose from 'mongoose';

const creditNoteSchema = new mongoose.Schema({
  cnId:       { type: String, unique: true, required: true },
  party:      { type: String, required: true },
  against:    { type: String, default: '' },   // MR ID or return ref
  amount:     { type: Number, required: true },
  reason:     { type: String, default: '' },
  status: {
    type: String,
    enum: ['Open', 'Closed', 'Disputed'],
    default: 'Open',
  },
  daysOpen:   { type: Number, default: 0 },
  reminderSentAt: { type: Date },
}, { timestamps: true });

export default mongoose.model('CreditNote', creditNoteSchema);
