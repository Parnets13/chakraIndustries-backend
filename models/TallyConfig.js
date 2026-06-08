import mongoose from 'mongoose';

const tallyConfigSchema = new mongoose.Schema({
  serverUrl:    { type: String, default: 'http://localhost' },
  port:         { type: String, default: '9000' },
  companyName:  { type: String, default: '' },
  authType:     { type: String, enum: ['None','Basic Auth','API Key'], default: 'None' },
  apiKey:       { type: String, default: '' },
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
  updatedBy:        { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

export default mongoose.model('TallyConfig', tallyConfigSchema);
