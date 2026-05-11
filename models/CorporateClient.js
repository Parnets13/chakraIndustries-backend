import mongoose from 'mongoose';

const corporateClientSchema = new mongoose.Schema(
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
    tier: {
      type: String,
      enum: ['Silver', 'Gold', 'Platinum'],
      required: [true, 'Tier is required']
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

export default mongoose.models.CorporateClient || mongoose.model('CorporateClient', corporateClientSchema);
