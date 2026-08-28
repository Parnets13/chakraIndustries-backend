import mongoose from 'mongoose';

const materialReturnSchema = new mongoose.Schema({
  // CORE IDENTIFIERS
  returnRequestId: { type: String, unique: true, sparse: true },
  mrId:            { type: String, unique: true, required: true }, 
  docketId:        { type: String, sparse: true }, // Unique after approval, sparse allows multiple nulls
  returnId:        { type: String }, // For join keys
  warehouseId:     { type: String }, // For join keys
  skuId:           { type: String }, // For join keys
  batchId:         { type: String }, // For join keys
  returnDate:      { type: Date, default: Date.now },
  priority:        { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
  
  // STATUS & INTEGRATION
  approvalStatus:  { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  warehouseStatus: { type: String, enum: ['Pending', 'Received', 'In Progress'], default: 'Pending' },
  receiveDate:     { type: Date },
  receiverName:    { type: String },
  
  // PARTY DETAILS
  customerName:    { type: String, default: '' },
  supplierName:    { type: String, required: true },
  email:           { type: String, default: '' },
  mobileNumber:    { type: String, default: '' },
  pickupAddress:   { type: String, default: '' },
  pinCode:         { type: String, default: '' },
  gstNumber:       { type: String, default: '' },
  
  // ORDER & INVOICE DETAILS
  invoiceNo:       { type: String, default: '' },
  invoiceDate:     { type: Date },
  dispatchDate:    { type: Date },
  deliveryDate:    { type: Date },
  orderNo:         { type: String, default: '' },
  
  // PRODUCT DETAILS
  productName:     { type: String, default: '' },
  skuCode:         { type: String, default: '' },
  productSku:      { type: String, default: '' },
  batchNo:         { type: String, default: '' },
  returnQty:       { type: Number, default: 0 },
  expectedQty:     { type: Number, default: 0 },
  receivedQty:     { type: Number, default: 0 },
  unitPrice:       { type: Number, default: 0 },
  value:           { type: Number, default: 0 },
  gstAmount:       { type: Number, default: 0 },
  
  // TRANSPORT DETAILS
  pickupDate:      { type: Date },
  vehicleNo:       { type: String, default: '' },
  driverName:      { type: String, default: '' },
  driverMobile:    { type: String, default: '' },
  currentLocation: { type: String, default: '' },
  trackingStatus:  { type: String, default: '' },
  courierName:     { type: String, default: '' },
  awbNo:           { type: String, default: '' },
  lrNo:            { type: String, default: '' },
  eta:             { type: Date },
  assignedTeam:    { type: String, default: '' },
  podUrl:          { type: String, default: '' },
  
  // QC DETAILS
  qcStatus:        { type: String, enum: ['Pending', 'In Progress', 'Passed', 'Failed'], default: 'Pending' },
  qcDecision:      { type: String, enum: ['Accept', 'Reject', 'Rework', 'Partial Accept'], default: 'Accept' },
  qcApprovedQty:   { type: Number, default: 0 },
  qcRejectedQty:   { type: Number, default: 0 },
  qcBy:            { type: String, default: '' },
  qcDate:          { type: Date },
  qcFinalRemarks:  { type: String, default: '' },
  qcImages:        [{ type: String }],
  
  // FINANCE & RECONCILIATION
  financeStatus:   { type: String, enum: ['Pending', 'Approved', 'Completed'], default: 'Pending' },
  refundAmount:    { type: Number, default: 0 },
  creditNoteNo:    { type: String, default: '' },
  debitNoteNo:     { type: String, default: '' },
  settlementDate:  { type: Date },
  
  // ERP STAGE FLOW (Enterprise Flow)
  currentStage: {
    type: String,
    enum: [
      'REQUEST_RAISED',
      'APPROVED',
      'DOCKET_CREATED',
      'VEHICLE_ASSIGNED',
      'OUT_FOR_PICKUP',
      'PICKED_UP',
      'IN_TRANSIT',
      'ARRIVED_AT_WAREHOUSE',
      'RECEIVED',
      'QC_PENDING',
      'QC_PASSED',
      'QC_FAILED',
      'INVENTORY_UPDATED',
      'FINANCE_PENDING',
      'CLOSED'
    ],
    default: 'REQUEST_RAISED'
  },

  stageTimeline: [{
    stage: { type: String },
    user: { type: String },
    timestamp: { type: Date, default: Date.now },
    remarks: { type: String },
    status: { type: String, default: 'Completed' }
  }],

  // LOSS TRACKING
  lossAmount:         { type: Number, default: 0 },
  lossClassification: { type: String, default: '' },
  
  // TALLY SYNC
  tallySyncStatus:    { type: String, enum: ['Pending', 'Synced', 'Failed'], default: 'Pending' },
  tallySyncDate:      { type: Date },

  // METADATA
  warehouseName:      { type: String, default: '' },
  requestedBy:        { type: String, default: '' },
  approvedBy:         { type: String, default: '' },
  reason:             { type: String, default: '' },
  remarks:            { type: String, default: '' },
  photoUrl:           { type: String, default: '' },
  orderedQty:         { type: Number, default: 0 },

  // Dealer app link — set when return is raised from dealer portal
  dealerId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Dealer', default: null },

  // ── Delivery Agent Material Return fields ───────────────────────────────────
  // When a return is created from the ChakraDeliver app against a delivered schedule
  returnGroupId:      { type: String, default: '' },   // Groups multiple items from same return submission
  deliveryScheduleId: { type: String, default: '' },   // ref to DeliverySchedule.scheduleId
  originalDeliveredQty: { type: Number, default: 0 },  // qty originally delivered
  previouslyReturnedQty:{ type: Number, default: 0 },  // snapshot of already-returned qty at creation time
  returnReason: {
    type: String,
    enum: ['Damaged', 'Wrong Material', 'Excess Material', 'Customer Rejection', 'Defective', 'Replacement', 'Warranty Return', 'Other', ''],
    default: ''
  },
  // Condition breakdown — must sum to returnQty
  conditionBreakdown: {
    good:       { type: Number, default: 0 },  // Good / Resalable
    damaged:    { type: Number, default: 0 },  // Damaged
    repairable: { type: Number, default: 0 },  // Repairable
    scrap:      { type: Number, default: 0 },  // Scrap
  },
  itemRemarks:        { type: String, default: '' },
  createdByAgentId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  sourceApp:          { type: String, enum: ['erp', 'dealer_app', 'delivery_app', ''], default: '' },

  // Idempotency key — prevents duplicate submissions from network retries / double-tap
  // Sparse + unique: only enforced when a key is present; absent/undefined allowed multiple times.
  // IMPORTANT: no `default` here — when the frontend sends no key the field must be
  // completely absent from the document so the sparse compound index skips it.
  idempotencyKey:     { type: String, sparse: true },
}, {
  timestamps: true
});

// Compound sparse unique index: same key for same dealer = duplicate
materialReturnSchema.index(
  { dealerId: 1, idempotencyKey: 1 },
  { unique: true, sparse: true, name: 'dealer_idempotency_key' }
);

const MaterialReturn = mongoose.models.MaterialReturn || mongoose.model('MaterialReturn', materialReturnSchema);
export default MaterialReturn;
