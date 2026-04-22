import mongoose from 'mongoose';

const warehouseSchema = new mongoose.Schema({
  warehouseId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  name: {
    type: String,
    required: true
  },
  location: {
    type: String,
    required: true
  },
  capacity: {
    type: Number,
    required: true,
    default: 0
  },
  used: {
    type: Number,
    default: 0
  },
  manager: {
    type: String
  },
  status: {
    type: String,
    enum: ['Active', 'Inactive', 'Maintenance'],
    default: 'Active'
  },
  zones: [{
    zoneId: String,
    name: String,
    color: String,
    racks: [{
      rackId: String,
      name: String,
      shelves: [{
        shelfId: String,
        bins: [String]
      }]
    }]
  }]
}, {
  timestamps: true
});

export default mongoose.model('Warehouse', warehouseSchema);
