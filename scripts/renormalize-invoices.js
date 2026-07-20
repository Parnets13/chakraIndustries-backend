
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

  console.log('Fetching invoices...');
  const invoices = await Invoice.find({}).lean();
  console.log(`Found ${invoices.length} invoices`);

  let updated = 0;
  for (const inv of invoices) {
    try {
      console.log(`Processing invoice ${inv.invoiceNo}...`);
      const normalized = normalizeToTallyVoucher(inv);
      await Invoice.updateOne(
        { _id: inv._id },
        { $set: { tallyVoucher: normalized } }
      );
      updated++;
      console.log(`Updated invoice ${inv.invoiceNo}`);
    } catch (err) {
      console.error(`Failed to update invoice ${inv.invoiceNo}:`, err.message);
    }
  }

  console.log(`Done! Updated ${updated} invoices`);
  await mongoose.disconnect();
}

main().catch(console.error);
