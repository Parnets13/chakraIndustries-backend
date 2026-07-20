
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

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

  console.log('\n=== Invoice BIW954 Raw Data ===');
  console.log(JSON.stringify(invoice, null, 2));

  console.log('\n=== Invoice BIW954 Tally Voucher ===');
  console.log(JSON.stringify(invoice.tallyVoucher, null, 2));

  await mongoose.disconnect();
}

main().catch(console.error);
