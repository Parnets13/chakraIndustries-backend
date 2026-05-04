import mongoose from 'mongoose';

const defectiveStockSchema = new mongoose.Schema({
  defectId: {
    type: String,
    required: true,
    unique: true,
    uppercase: true
  },
  sku: {
    type: String,
    required: true
  },
  itemName: String,
  quantity: Number,
  defectType: {
    type: String,
    enum: ['Dimensional', 'Surface Defect', 'Packaging Damage', 'Functional Failure', 'Other'],
    default: 'Other'
  },
  source: {
    type: String,
    enum: ['GRN Inspection', 'Production', 'Customer Return', 'Internal Audit'],
    default: 'GRN Inspection'
  },
  stage: {
    type: String,
    enum: ['QC Hold', 'Defective Bin', 'Repair', 'Scrap'],
    default: 'QC Hold'
  },
  warehouse: String,
  remarks: String,
  daysAged: {
    type: Number,
    default: 0
  }
}, {
  timestamps: true
});

export default mongoose.model('DefectiveStock', defectiveStockSchema);
