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
      trim: true,
      default: '',
      // Not required — Tally ledgers often have no phone; we store what we have
      match: [/^(\d{10}|\d{0})?$/, 'Phone must be 10 digits or empty'],
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
    state: {
      type: String,
      trim: true
    },
    pincode: {
      type: String,
      trim: true,
      match: [/^(\d{6})?$/, 'Pincode must be exactly 6 digits']
    },
    category: {
      type: String,
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
    remarks: {
      type: String,
      trim: true
    },
    status: {
      type: String,
      enum: ['Active', 'Inactive', 'Blocked'],
      default: 'Active'
    },
    
    // Data source — 'ERP' for records created in this system, 'Tally' for records imported from Tally.
    // Only 'ERP' records are eligible for export back to Tally.
    dataSource: {
      type: String,
      enum: ['ERP', 'Tally'],
      default: 'ERP',
      index: true
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
