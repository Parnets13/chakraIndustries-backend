import mongoose from 'mongoose';

const materialReturnSchema = new mongoose.Schema({
  // RETURN DETAILS
  returnRequestId: { type: String, unique: true, sparse: true },
  mrId:       { type: String, unique: true, required: true }, // Return ID
  returnDate: { type: Date, default: Date.now },
  returnStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected', 'Processing'], default: 'Pending' },
  rmaNumber:  { type: String, default: '' },
  priority:   { type: String, enum: ['Low', 'Medium', 'High', 'Critical'], default: 'Medium' },
  
  // CUSTOMER / DEALER DETAILS
  customerName: { type: String, default: '' },
  dealerName:   { type: String, default: '' },
  mobileNumber: { type: String, default: '' },
  email:        { type: String, default: '' },
  pickupAddress: { type: String, default: '' },
  pinCode:      { type: String, default: '' },
  gstNumber:    { type: String, default: '' },
  
  // ORDER & INVOICE DETAILS
  orderNo:      { type: String, default: '' },
  invoiceNo:    { type: String, default: '' },
  invoiceDate:  { type: Date },
  dispatchDate: { type: Date },
  deliveryDate: { type: Date },
  
  // PRODUCT DETAILS
  productName:  { type: String, default: '' },
  skuCode:      { type: String, default: '' },
  productSku:   { type: String, default: '' }, // Additional SKU field
  productSource: { type: String, default: '' }, // Source: Item Master, GRN, PO
  batchNo:      { type: String, default: '' },
  barcodeSerialNo: { type: String, default: '' },
  returnQty:    { type: Number, default: 0 },
  damagedQty:   { type: Number, default: 0 },
  missingQty:   { type: Number, default: 0 },
  unitPrice:    { type: Number, default: 0 },
  gstAmount:    { type: Number, default: 0 },
  
  // TRANSPORT DETAILS
  docketId:     { type: String, unique: true, required: true },
  pickupDate:   { type: Date },
  vehicleNo:    { type: String, default: '' },
  driverName:   { type: String, default: '' },
  driverMobile: { type: String, default: '' },
  expectedDeliveryDate: { type: Date },
  currentLocation: { type: String, default: '' },
  podUpload:    { type: String, default: '' }, // File path
  trackingStatus: { type: String, default: '' }, // Additional tracking status
  
  // DAMAGE / LOSS DETAILS
  damageType:     { type: String, enum: ['Physical', 'Functional', 'Packaging', 'Missing', 'Other'], default: 'Physical' },
  damageSeverity: { type: String, enum: ['Minor', 'Major', 'Critical', 'Total Loss'], default: 'Minor' },
  damageImages:   [{ type: String }], // Array of image paths
  lossAmount:     { type: Number, default: 0 },
  insuranceClaim: { type: String, enum: ['Not Applicable', 'Pending', 'Approved', 'Rejected'], default: 'Not Applicable' },
  
  // QC DETAILS
  qcStatus:   { type: String, enum: ['Pending', 'In Progress', 'Passed', 'Failed'], default: 'Pending' },
  qcRemarks:  { type: String, default: '' },
  qcImages:   [{ type: String }], // Array of image paths
  qcEngineer: { type: String, default: '' },
  qcDecision: { type: String, enum: ['Accept', 'Reject', 'Rework', 'Partial Accept'], default: 'Accept' },
  
  // INVENTORY DETAILS
  warehouseName: { type: String, default: '' },
  rackLocation:  { type: String, default: '' },
  
  // WAREHOUSE RECEIVE DETAILS
  expectedQty:      { type: Number, default: 0 },
  receivedQty:      { type: Number, default: 0 },
  damagedQtyReceived: { type: Number, default: 0 },
  missingQtyReceived: { type: Number, default: 0 },
  warehouseLocation: { type: String, default: '' },
  receivedBy:       { type: String, default: '' },
  receiveDate:      { type: Date },
  warehouseRemarks: { type: String, default: '' },
  
  // QC RECEIVE DETAILS
  qcReceivedQty:    { type: Number, default: 0 },
  qcApprovedQty:    { type: Number, default: 0 },
  qcRejectedQty:    { type: Number, default: 0 },
  qcBy:             { type: String, default: '' },
  qcDate:           { type: Date },
  qcFinalRemarks:   { type: String, default: '' },
  inventoryType: { type: String, enum: ['Raw Material', 'Finished Goods', 'WIP', 'Consumables'], default: 'Raw Material' },
  stockImpact:   { type: String, enum: ['Increase', 'Decrease', 'No Change'], default: 'Increase' },
  
  // FINANCE & RECONCILIATION
  refundAmount:  { type: Number, default: 0 },
  creditNoteNo:  { type: String, default: '' },
  debitNoteNo:   { type: String, default: '' },
  ledgerStatus:  { type: String, enum: ['Pending', 'Updated', 'Reconciled'], default: 'Pending' },
  reconciliationStatus: { type: String, enum: ['Pending', 'In Progress', 'Completed'], default: 'Pending' },
  
  // APPROVAL DETAILS
  requestedBy:    { type: String, default: '' },
  approvedBy:     { type: String, default: '' },
  approvalStatus: { type: String, enum: ['Pending', 'Approved', 'Rejected'], default: 'Pending' },
  approvalRemarks: { type: String, default: '' },
  
  // ATTACHMENTS
  invoiceUpload:     { type: String, default: '' }, // File path
  damagePhotos:      [{ type: String }], // Array of image paths
  qcReport:          { type: String, default: '' }, // File path
  supportingDocuments: [{ type: String }], // Array of file paths
  
  // LEGACY FIELDS (keeping for backward compatibility)
  poId:       { type: mongoose.Schema.Types.ObjectId, ref: 'PurchaseOrder' },
  vendorId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' },
  supplierName: { type: String, required: true },
  
  // Supplier details (simplified)
  supplierEmail: { type: String, default: '' },
  supplierPincode: { type: String, default: '' },
  supplierGSTNo: { type: String, default: '' },
  supplierAddress: { type: String, default: '' },
  
  items:      { type: Number, default: 1 },
  value:      { type: Number, default: 0 },
  reason:     { type: String, required: true },
  transport:  { type: String, default: '' },
  awbNo:      { type: String, default: '' },
  stage: {
    type: String,
    enum: [
      'Invoice_Select',
      'Invoice_API_Fetch',
      'Supplier_Products_Auto_Fetch',
      'Return_Request_Create',
      'MR_ID_Generate',
      'Manager_Approval',
      'Docket_Create',
      'Transport_Tracking',
      'Warehouse_Receive',
      'QC_Verification',
      'Finance_Reconciliation',
      'Tally_Sync',
      'Initiated',
      'Approved',
      'Transport_Pickup',
      'In_Transit',
      'Out_For_Delivery',
      'Delivered',
      'Warehouse_Queue',
      'Received_At_Warehouse',
      'QC_In_Progress',
      'QC_Completed',
      'Closed'
    ],
    default: 'Initiated',
  },
  creditNoteId: { type: String, default: '' },
  debitNoteId:  { type: String, default: '' },
  stockReversed: { type: Boolean, default: false },
  
  // WORKFLOW TRACKING FIELDS
  currentWorkflowStage: { 
    type: String, 
    enum: [
      'Invoice_Select',
      'Invoice_API_Fetch',
      'Supplier_Products_Auto_Fetch',
      'Return_Request_Create',
      'MR_ID_Generate',
      'Manager_Approval',
      'Docket_Create',
      'Transport_Tracking',
      'Warehouse_Receive',
      'QC_Verification',
      'Finance_Reconciliation',
      'Tally_Sync',
      'Return_Created',
      'Invoice_Validation',
      'Tracking_Start',
      'Warehouse_Receiving',
      'QC_Check',
      'Stock_Ledger_Entry',
      'Finance_Settlement',
      'Reconciliation_Engine'
    ],
    default: 'Return_Created'
  },
  assignedTo: { type: String, default: '' },
  
  // Workflow stage timestamps
  Return_Created_processedAt: { type: Date },
  Return_Created_processedBy: { type: String, default: '' },
  Invoice_Validation_processedAt: { type: Date },
  Invoice_Validation_processedBy: { type: String, default: '' },
  Tracking_Start_processedAt: { type: Date },
  Tracking_Start_processedBy: { type: String, default: '' },
  Warehouse_Receiving_processedAt: { type: Date },
  Warehouse_Receiving_processedBy: { type: String, default: '' },
  QC_Check_processedAt: { type: Date },
  QC_Check_processedBy: { type: String, default: '' },
  Stock_Ledger_Entry_processedAt: { type: Date },
  Stock_Ledger_Entry_processedBy: { type: String, default: '' },
  Finance_Settlement_processedAt: { type: Date },
  Finance_Settlement_processedBy: { type: String, default: '' },
  Reconciliation_Engine_processedAt: { type: Date },
  Reconciliation_Engine_processedBy: { type: String, default: '' },
  Tally_Sync_processedAt: { type: Date },
  Tally_Sync_processedBy: { type: String, default: '' },
  Invoice_Select_processedAt: { type: Date },
  Invoice_Select_processedBy: { type: String, default: '' },
  Invoice_API_Fetch_processedAt: { type: Date },
  Invoice_API_Fetch_processedBy: { type: String, default: '' },
  Supplier_Products_Auto_Fetch_processedAt: { type: Date },
  Supplier_Products_Auto_Fetch_processedBy: { type: String, default: '' },
  Return_Request_Create_processedAt: { type: Date },
  Return_Request_Create_processedBy: { type: String, default: '' },
  MR_ID_Generate_processedAt: { type: Date },
  MR_ID_Generate_processedBy: { type: String, default: '' },
  Manager_Approval_processedAt: { type: Date },
  Manager_Approval_processedBy: { type: String, default: '' },
  Docket_Create_processedAt: { type: Date },
  Docket_Create_processedBy: { type: String, default: '' },
  Transport_Tracking_processedAt: { type: Date },
  Transport_Tracking_processedBy: { type: String, default: '' },
  Warehouse_Receive_processedAt: { type: Date },
  Warehouse_Receive_processedBy: { type: String, default: '' },
  QC_Verification_processedAt: { type: Date },
  QC_Verification_processedBy: { type: String, default: '' },
  Finance_Reconciliation_processedAt: { type: Date },
  Finance_Reconciliation_processedBy: { type: String, default: '' },
  
  // Additional QC fields for WarehouseReceivePage
  qcDamageQty: { type: Number, default: 0 },
  qcMissingQty: { type: Number, default: 0 },
  qcNotes: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('MaterialReturn', materialReturnSchema);
