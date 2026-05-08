import mongoose from 'mongoose';

const clientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      unique: true,
      required: true,
      index: true
    },
    name: {
      type: String,
      required: [true, 'Company name is required'],
      trim: true
    },
    contact: {
      type: String,
      required: [true, 'Contact person is required'],
      trim: true
    },
    phone: {
      type: String,
      required: [true, 'Phone is required'],
      match: [/^\d{10}$/, 'Phone must be exactly 10 digits'],
    },
    email: {
      type: String,
      required: [true, 'Email is required']
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    category: {
      type: String,
      enum: ['Manufacturing', 'Trading', 'Distributor'],
      required: [true, 'Category is required']
    },
    creditLimit: {
      type: Number,
      default: 0
    },
    outstanding: {
      type: Number,
      default: 0
    },
    gstNumber: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive'],
      default: 'Active'
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Client', clientSchema);
