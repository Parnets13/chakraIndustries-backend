import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';

await connectDB();
const MAX_RETRIES = 3;
const query = {
  status: { $nin: ['Cancelled'] },
  source: { $nin: ['Tally', 'tally'] },
  $and: [
    {
      $or: [
        { tallySync: { $ne: true } },
        { tallySync: true, tallySyncAt: { $exists: false } }
      ]
    },
    {
      $or: [
        { retryCount: { $exists: false } },
        { retryCount: { $lt: MAX_RETRIES } }
      ]
    }
  ]
};

const count = await Invoice.countDocuments(query);
const invoiceNo = process.env.INVOICE_NO || process.argv[2];
if (!invoiceNo) { console.error('Provide invoiceNo via INVOICE_NO env or CLI arg'); process.exit(1); }
const biw20 = await Invoice.findOne({ invoiceNo }).lean();

console.log('PENDING_QUERY_COUNT', count);
console.log(JSON.stringify({ biw20: biw20 ? {
  invoiceNo: biw20.invoiceNo,
  status: biw20.status,
  source: biw20.source,
  tallySync: biw20.tallySync,
  tallySyncAt: biw20.tallySyncAt,
  retryCount: biw20.retryCount,
  buyersOrderNo: biw20.buyersOrderNo,
  tallyGuid: biw20.tallyGuid,
  tallyVoucherNumber: biw20.tallyVoucherNumber
} : null }, null, 2));

process.exit(0);
