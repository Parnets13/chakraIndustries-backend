import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';
import util from 'util';
await connectDB();
const invoiceNo = process.env.INVOICE_NO || process.argv[2];
if (!invoiceNo) { console.error('Provide invoiceNo via INVOICE_NO env or CLI arg'); process.exit(1); }
const inv = await Invoice.findOne({ invoiceNo }).lean({ virtuals: false });
const invoiceDateType = inv && inv.invoiceDate !== undefined ? (inv.invoiceDate === null ? 'null' : Object.prototype.toString.call(inv.invoiceDate)) : 'undefined';
console.log('RAW_INVOICE_DOC:');
console.log(util.inspect(inv, { depth: 4, colors: false, compact: false }));
console.log('INVOICE_DATE_TYPE:', invoiceDateType);
console.log('INVOICE_DATE_VALUE:', inv ? String(inv.invoiceDate) : 'not found');
process.exit(0);
