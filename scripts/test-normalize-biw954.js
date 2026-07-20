
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/chakra-industries';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected!');

  console.log('Fetching invoice BIW954...');
  const invoice = await Invoice.findOne({ invoiceNo: 'BIW954' }).lean();
  if (!invoice) {
    console.log('Invoice not found!');
    await mongoose.disconnect();
    return;
  }

  console.log('Calling normalizeToTallyVoucher...');
  const normalized = normalizeToTallyVoucher(invoice);

  console.log('\n=== Normalized Tally Voucher ===');
  console.log(JSON.stringify(normalized, null, 2));

  console.log('\n=== All Ledger Entries ===');
  console.log(JSON.stringify(normalized.allLedgerEntries, null, 2));

  await mongoose.disconnect();
}

main().catch(console.error);
