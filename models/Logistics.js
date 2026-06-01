import mongoose from 'mongoose';

const vehicleSchema = new mongoose.Schema({
  vehicleId:     { type: String, unique: true, required: true },
  type:          { type: String, required: true },
  name:          { type: String, default: '' },
  number:        { type: String, required: true, unique: true },
  driver:        { type: String, required: true },
  driverMobile:  { type: String, default: '' },
  capacity:      { type: String, default: '' },
  currentLoad:   { type: String, default: '' },
  currentDocket: { type: String, default: '' },
  currentRoute:  { type: String, default: '' },
  status:        { type: String, enum: ['Available', 'Assigned', 'Pickup Pending', 'In Transit', 'Arrived', 'Maintenance', 'Inactive'], default: 'Available' },
}, { timestamps: true });

const dispatchSchema = new mongoose.Schema({
  dispatchId:   { type: String, unique: true, required: true },
  orderRef:     { type: String, required: true },
  customer:     { type: String, required: true },
  vehicleId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Vehicle' },
  vehicleNo:    { type: String, default: '' },
  driver:       { type: String, default: '' },
  origin:       { type: String, default: '' },
  destination:  { type: String, required: true },
  items:        { type: Number, default: 0 },
  weight:       { type: String, default: '' },
  value:        { type: Number, default: 0 },
  dispatchDate: { type: Date },
  expectedDelivery: { type: Date },
  deliveredAt:  { type: Date },
  status:       { type: String, enum: ['Pending', 'Dispatched', 'In Transit', 'Delivered', 'Cancelled'], default: 'Pending' },
  instructions: { type: String, default: '' },
  regularized:  { type: Boolean, default: false },
  regularizedAt: { type: Date },
  timeline: [{
    event:    { type: String },
    time:     { type: Date, default: Date.now },
    location: { type: String, default: '' },
    status:   { type: String, enum: ['success', 'warning', 'gray'], default: 'success' },
  }],
}, { timestamps: true });

const courierShipmentSchema = new mongoose.Schema({
  shipmentId:   { type: String, unique: true, required: true },
  courier:      { type: String, required: true },
  awbNo:        { type: String, required: true },
  orderRef:     { type: String, required: true },
  customer:     { type: String, required: true },
  destination:  { type: String, required: true },
  eta:          { type: Date },
  status:       { type: String, enum: ['Booked', 'In Transit', 'Out for Delivery', 'Delivered', 'Returned'], default: 'Booked' },
  pod:          { type: Boolean, default: false },
  podUrl:       { type: String, default: '' },
  receivedBy:   { type: String, default: '' },
  deliveredAt:  { type: Date },
}, { timestamps: true });

export const Vehicle         = mongoose.model('Vehicle', vehicleSchema);
export const Dispatch        = mongoose.model('Dispatch', dispatchSchema);
export const CourierShipment = mongoose.model('CourierShipment', courierShipmentSchema);
