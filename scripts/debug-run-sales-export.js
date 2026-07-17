import 'dotenv/config';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { exportSalesInvoices } from '../services/tallyExportService.js';

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log('Connected to MongoDB');

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();
if (!cfg) {
  console.error('No TallyConfig found');
  process.exit(1);
}

const result = await exportSalesInvoices(cfg, 'debug-run');
console.log('EXPORT RESULT:', result);

await mongoose.disconnect();
process.exit(0);
