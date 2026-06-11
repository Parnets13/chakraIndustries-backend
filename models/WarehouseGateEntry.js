import mongoose from 'mongoose';

const gateEntrySchema = new mongoose.Schema({
  gateEntryId: { type: String, unique: true, required: true },
  returnId:    { type: String, ref: 'MaterialReturn', required: true },
  docketId:    { type: String, ref: 'DocketTracking' },
  vehicleNo:   { type: String, required: true },
  driverName:  { type: String },
  driverMobile:{ type: String },
  entryTime:   { type: Date, default: Date.now },
  exitTime:    { type: Date },
  status:      { type: String, enum: ['Entered', 'Exited'], default: 'Entered' },
  securityBy:  { type: String }
}, { timestamps: true });

export default mongoose.model('WarehouseGateEntry', gateEntrySchema);
