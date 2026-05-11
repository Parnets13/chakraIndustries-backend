import mongoose from 'mongoose';

const salesOrderSchema = new mongoose.Schema({
  orderId:    { type: String, required: true, unique: true },
  customer:   { type: String, required: true, trim: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client' },
  items:      { type: Number, default: 0 },
  value:      { type: Number, default: 0 },
  priority:   { type: String, enum: ['Low','Normal','High','Urgent'], default: 'Normal' },
  status:     { type: String, enum: ['Pending','Processing','Shipped','Delivered','Cancelled'], default: 'Pending' },
  orderDate:  { type: Date, default: Date.now },
  remarks:    { type: String, default: '' },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

salesOrderSchema.index({ orderId: 1 });
salesOrderSchema.index({ status: 1 });
salesOrderSchema.index({ customer: 1 });
salesOrderSchema.index({ orderDate: -1 });

export default mongoose.model('SalesOrder', salesOrderSchema);
