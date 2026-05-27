import mongoose from 'mongoose';

const defectLogSchema = new mongoose.Schema({
  defectId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'DefectiveStock',
    required: true
  },
  actionType: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String
  },
  previousStatus: {
    type: String
  },
  currentStatus: {
    type: String
  },
  warehouse: {
    type: String
  },
  location: {
    type: String
  },
  performedBy: {
    type: String,
    default: 'System'
  }
}, {
  timestamps: true
});

export default mongoose.model('DefectLog', defectLogSchema);
