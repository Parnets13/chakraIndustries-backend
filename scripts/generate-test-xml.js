
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/chakra-industries';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected!');

  const invoice = await Invoice.findOne({ invoiceNo: 'BIW959' }).lean();
  console.log('Found invoice BIW959, normalizing to tally voucher...');
  const tallyVoucher = normalizeToTallyVoucher(invoice);
  console.log('Normalized, serializing to XML...');
  const xml = serializeTallyVoucher(tallyVoucher, { companyName: 'SRI CHAKRA INDUSTRIES', state: 'Karnataka' }, 'Create', '');
  console.log('Generated XML:\n');
  console.log(xml);

  await mongoose.disconnect();
}

main().catch(console.error);
