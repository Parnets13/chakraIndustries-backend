import mongoose from 'mongoose';

const oemFinishedGoodsSchema = new mongoose.Schema({
  finishedGoodsId: {
    type: String,
    unique: true,
    required: true,
    index: true
  },
  oemOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'OEMOrder',
    required: true
  },
  product: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  unit: String,
  batchNumber: {
    type: String,
    required: true,
    unique: true
  },
  qcCheckId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'QualityCheck'
  },
  qcStatus: {
    type: String,
    enum: ['Passed', 'Failed', 'Rework'],
    required: true
  },
  defectCount: {
    type: Number,
    default: 0
  },
  defectDetails: String,
  productionDate: Date,
  qcDate: Date,
  storageLocation: {
    warehouseId: mongoose.Schema.Types.ObjectId,
    locationId: mongoose.Schema.Types.ObjectId,
    binNumber: String
  },
  status: {
    type: String,
    enum: ['In-Storage', 'Dispatch-Ready', 'Dispatched', 'Delivered'],
    default: 'In-Storage'
  },
  dispatchDate: Date,
  trackingNumber: String,
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

oemFinishedGoodsSchema.index({ oemOrderId: 1 });
oemFinishedGoodsSchema.index({ batchNumber: 1 });
oemFinishedGoodsSchema.index({ status: 1 });

export default mongoose.model('OEMFinishedGoods', oemFinishedGoodsSchema);
