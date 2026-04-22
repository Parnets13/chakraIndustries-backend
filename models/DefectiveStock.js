import mongoose from 'mongoose';

const defectiveStockSchema = new mongoose.Schema({
  defectId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  inventory: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    required: true
  },
  sku: {
    type: String,
    required: true
  },
  itemName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true
  },
  defectType: {
    type: String,
    enum: ['Dimensional', 'Surface Defect', 'Packaging Damage', 'Material Defect', 'Other'],
    required: true
  },
  source: {
    type: String,
    enum: ['GRN Inspection', 'Production', 'Customer Return', 'Internal Audit'],
    required: true
  },
  stage: {
    type: String,
    enum: ['QC Hold', 'Defective Bin', 'Repair', 'Disposed', 'Returned'],
    default: 'QC Hold'
  },
  daysAged: {
    type: Number,
    default: 0
  },
  remarks: {
    type: String
  },
  reportedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

export default mongoose.model('DefectiveStock', defectiveStockSchema);
