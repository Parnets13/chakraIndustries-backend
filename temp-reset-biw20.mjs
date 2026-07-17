import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';
await connectDB();
const invoiceNo = process.env.INVOICE_NO || process.argv[2];
if (!invoiceNo) { console.error('Provide invoiceNo via INVOICE_NO env or CLI arg'); process.exit(1); }
const result = await Invoice.findOneAndUpdate(
  { invoiceNo },
  { $set: { retryCount: 2, tallySync: false }, $unset: { tallySyncAt: '' } },
  { new: true }
).lean();
console.log(JSON.stringify(result ? { invoiceNo: result.invoiceNo, tallySync: result.tallySync, tallySyncAt: result.tallySyncAt, retryCount: result.retryCount, source: result.source, status: result.status } : { found: false }, null, 2));
process.exit(0);
