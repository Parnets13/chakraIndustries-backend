import dotenv from 'dotenv';
dotenv.config();
import dns from 'dns';
import mongoose from 'mongoose';

dns.setServers(['8.8.8.8', '8.8.4.4']);
await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });

const TallyVoucher = (await import('../models/TallyVoucher.js')).default;

const docs = await TallyVoucher.find({ irn: { $exists: true, $ne: '' } }).limit(5).lean();
for (const d of docs) {
  console.log(`voucherNumber: ${d.voucherNumber}`);
  console.log(`irn (${(d.irn||'').length} chars): "${d.irn}"`);
  console.log('---');
}
await mongoose.disconnect();
