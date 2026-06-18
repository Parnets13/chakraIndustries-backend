import mongoose from 'mongoose';

const bankAccountSchema = new mongoose.Schema({
  accountName: {
    type: String,
    required: true,
  },
  accountNumber: {
    type: String,
  },
  type: {
    type: String,
    enum: ['Bank', 'Cash'],
    required: true,
  },
  balance: {
    type: Number,
    default: 0,
  },
  bankName: {
    type: String,
  },
  ifscCode: {
    type: String,
  },
}, {
  timestamps: true,
});

export default mongoose.model('BankAccount', bankAccountSchema);
