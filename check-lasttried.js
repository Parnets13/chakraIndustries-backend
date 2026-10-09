import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

async function main() {
  await connectDB();
  const invs = await Invoice.find({ tallySync: { $ne: true } })
    .select('invoiceNo lastError lastTriedAt retryCount updatedAt').lean();
  invs.forEach(i => {
    console.log(
      i.invoiceNo,
      '| lastTried:', i.lastTriedAt ? new Date(i.lastTriedAt).toISOString().slice(0,19) : 'NEVER',
      '| updated:', i.updatedAt ? new Date(i.updatedAt).toISOString().slice(0,19) : '-',
      '| retry:', i.retryCount || 0,
      '| err:', (i.lastError || '(empty)').slice(0, 60)
    );
  });
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
