import mongoose from 'mongoose';

const tallyConfigSchema = new mongoose.Schema({
  // URL of the ERP itself (for webhook reference only — NOT used to pull from Tally)
  serverUrl:    { type: String, default: 'https://erp.majesticmall.net' },
  // Local IP/hostname where Tally Prime HTTP server is running (e.g. http://192.168.1.10)
  tallyLocalUrl:{ type: String, default: '' },
  port:         { type: String, default: '9000' },
  companyName:  { type: String, default: '' },
  // Financial year start date (e.g. 2026-04-01 for Apr 2026 – Mar 2027).
  // Used as the lower bound when fetching vouchers from Tally for the first time.
  financialYearStart: { type: Date, default: null },
  authType:     { type: String, enum: ['None','Basic Auth','API Key'], default: 'None' },
  apiKey:       { type: String, default: '' },
  // Enhanced settings for bi-directional sync
  enableGuidTracking: { type: Boolean, default: true },
  syncCustomers: { type: Boolean, default: true },
  syncVendors: { type: Boolean, default: true },
  syncProducts: { type: Boolean, default: true },
  syncInvoices: { type: Boolean, default: true },
  syncPurchaseOrders: { type: Boolean, default: true },
  syncReceipts: { type: Boolean, default: true },
  syncPayments: { type: Boolean, default: true },
  autoSync:     { type: Boolean, default: true },
  syncInterval: { type: String, default: 'Every 15 minutes' },
  syncDirection:{ type: String, enum: ['ERP → Tally','Tally → ERP','Bi-directional'], default: 'Bi-directional' },
  syncPrefs: {
    masterData:       { type: Boolean, default: true },
    purchaseVouchers: { type: Boolean, default: true },
    salesVouchers:    { type: Boolean, default: true },
    paymentVouchers:  { type: Boolean, default: true },
    receiptVouchers:  { type: Boolean, default: true },
    journalVouchers:  { type: Boolean, default: false },
  },
  connectionStatus: { type: String, enum: ['Connected','Disconnected','Unknown'], default: 'Unknown' },
  lastSyncAt:       { type: Date },
  lastImportAt:     { type: Date },
  lastExportAt:     { type: Date },
  tallyPeriodEnd:   { type: String, default: null }, // YYYYMMDD — cached from last successful fetchTallyPeriodEnd
  updatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  
  // Company dispatch / GST details (used when building Sales Voucher XML for Tally)
  // These are Sri Chakra Industries' own details — the "from" side of every invoice.
  gstin:   { type: String, default: '29ABWFS0002M1ZR' },  // company GSTIN
  state:   { type: String, default: 'Karnataka' },         // dispatch from state
  city:    { type: String, default: 'Bengaluru' },         // dispatch from city
  pincode: { type: String, default: '560039' },            // dispatch from pincode
  address: { type: String, default: '13/14, Azeez Sait Industrial Estate, Nayandahalli, Mysore Road, Bangalore-560039' },

  // Connector settings
  useConnector:    { type: Boolean, default: false },
  connectorId:     { type: String, default: '' },
  connectorSecret: { type: String, default: '' },
}, { timestamps: true });

export default mongoose.model('TallyConfig', tallyConfigSchema);
