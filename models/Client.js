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
      trim: true
    },
    city: {
      type: String,
      required: [true, 'City is required'],
      trim: true
    },
    category: {
      type: String,
      enum: ['Regular', 'Premium', 'Corporate', 'Distributor', 'Retailer', 'Manufacturing', 'Trading'],
      default: 'Regular'
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
      enum: ['Active', 'Inactive', 'Blocked'],
      default: 'Active'
    },
    
    // Tally Integration Fields
    tallyGuid: {
      type: String,
      trim: true,
      sparse: true,
      index: true
    },
    tallyAlterId: {
      type: String,
      trim: true
    },
    tallySynced: {
      type: Boolean,
      default: false
    },
    lastTallySync: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Client', clientSchema);
