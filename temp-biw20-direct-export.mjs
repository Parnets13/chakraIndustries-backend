import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';
import TallyConfig from './models/TallyConfig.js';
import { exportSalesInvoices } from './services/tallyExportService.js';

await connectDB();

const invoiceNo = process.env.INVOICE_NO || process.argv[2];
if (!invoiceNo) {
  console.error('Provide invoiceNo via INVOICE_NO env or CLI arg');
  process.exit(1);
}
const current = await Invoice.findOne({ invoiceNo }).lean();
if (!current) {
  console.error(`ERROR: ${invoiceNo} invoice not found`);
  process.exit(1);
}
console.log('BEFORE UPDATE: retryCount=', current.retryCount, 'tallySync=', current.tallySync);

await Invoice.updateOne({ invoiceNo }, { $set: { retryCount: 2, tallySync: false } });
const after = await Invoice.findOne({ invoiceNo }).lean();
console.log('AFTER UPDATE: retryCount=', after.retryCount, 'tallySync=', after.tallySync);

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) {
  console.error('ERROR: TallyConfig not found');
  process.exit(1);
}

// Restrict exportSalesInvoices to BIW20 only by patching Invoice.find.
const originalFind = Invoice.find.bind(Invoice);
Invoice.find = function(query) {
  console.log('PATCHED Invoice.find called with query:', JSON.stringify(query));
  return originalFind(query).where('invoiceNo').equals(invoiceNo);
};

const result = await exportSalesInvoices(cfg, 'direct-test');
console.log('EXPORT RESULT:', result);
process.exit(0);
