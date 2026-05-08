import mongoose from 'mongoose';

const corporateClientSchema = new mongoose.Schema({
  clientId:     { type: String, unique: true, required: true },
  name:         { type: String, required: true },
  contact:      { type: String, required: true },
  phone:        { type: String, default: '', match: [/^(\d{10})?$/, 'Phone must be exactly 10 digits'] },
  email:        { type: String, default: '' },
  city:         { type: String, default: '' },
  address:      { type: String, default: '' },
  gstNumber:    { type: String, default: '' },
  tier:         { type: String, enum: ['Silver', 'Gold', 'Platinum'], default: 'Silver' },
  creditLimit:  { type: Number, default: 0 },
  outstanding:  { type: Number, default: 0 },
  status:       { type: String, enum: ['Active', 'Inactive'], default: 'Active' },
}, { timestamps: true });

const bulkQuotationSchema = new mongoose.Schema({
  quoteId:      { type: String, unique: true, required: true },
  clientId:     { type: mongoose.Schema.Types.ObjectId, ref: 'CorporateClient', required: true },
  clientName:   { type: String, required: true },
  items: [{
    item:       { type: String, required: true },
    sku:        { type: String, default: '' },
    qty:        { type: Number, required: true },
    unitPrice:  { type: Number, required: true },
    discount:   { type: Number, default: 0 },
    total:      { type: Number, required: true },
  }],
  subtotal:     { type: Number, default: 0 },
  gstAmount:    { type: Number, default: 0 },
  grandTotal:   { type: Number, default: 0 },
  packaging:    { type: String, default: 'Standard Box' },
  paymentTerms: { type: String, default: 'Net 30' },
  validity:     { type: Date },
  status:       { type: String, enum: ['Draft', 'Sent', 'Approved', 'Rejected', 'Expired', 'Converted'], default: 'Draft' },
  remarks:      { type: String, default: '' },
}, { timestamps: true });

const deliveryScheduleSchema = new mongoose.Schema({
  scheduleId:   { type: String, unique: true, required: true },
  quoteId:      { type: mongoose.Schema.Types.ObjectId, ref: 'BulkQuotation' },
  clientName:   { type: String, required: true },
  items:        { type: Number, default: 0 },
  qty:          { type: Number, default: 0 },
  deliveryDate: { type: Date },
  slot:         { type: String, default: '' },
  warehouse:    { type: String, default: '' },
  vehicle:      { type: String, default: '' },
  status:       { type: String, enum: ['Draft', 'Confirmed', 'Pending', 'Dispatched', 'Delivered'], default: 'Pending' },
}, { timestamps: true });

export const CorporateClient  = mongoose.model('CorporateClient', corporateClientSchema);
export const BulkQuotation    = mongoose.model('BulkQuotation', bulkQuotationSchema);
export const DeliverySchedule = mongoose.model('DeliverySchedule', deliveryScheduleSchema);
