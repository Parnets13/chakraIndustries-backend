
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

dotenv.config();

const MONGODB_URI = process.env.MONGO_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/chakra-industries';

async function main() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected!');

  console.log('Fetching invoice BIW958...');
  const invoice = await Invoice.findOne({ invoiceNo: 'BIW958' }).lean();
  if (!invoice) {
    console.log('Invoice not found!');
    await mongoose.disconnect();
    return;
  }
  console.log('Original invoice data:');
  console.log('cgstTotal:', invoice.cgstTotal);
  console.log('sgstTotal:', invoice.sgstTotal);
  console.log('igstTotal:', invoice.igstTotal);
  console.log('grandTotal:', invoice.grandTotal);
  console.log('items:', JSON.stringify(invoice.items, null, 2));
  await mongoose.disconnect();
}

main().catch(console.error);
