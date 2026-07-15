#!/usr/bin/env node
import connectDB from './config/database.js';
import Invoice from './models/Invoice.js';

await connectDB();
const now = new Date();
const t1 = 'TESTGEN001';
const t2 = 'TESTGEN002';

const baseInvoice = (no, partyName, partyState) => ({
  invoiceNo: no,
  invoiceDate: now,
  partyName: partyName,
  partyAddress: '123 Test St',
  partyState: partyState || '',
  partyCity: 'TestCity',
  items: [
    { description: 'Test Item', qty: 1, rate: 1000, amount: 1000, total: 1000, cgst: 0, sgst: 0, igst: 0 }
  ],
  subtotal: 1000,
  totalTax: 0,
  grandTotal: 1000,
  status: 'Approved',
});

async function upsertInvoice(inv) {
  const existing = await Invoice.findOne({ invoiceNo: inv.invoiceNo });
  if (existing) {
    await Invoice.updateOne({ invoiceNo: inv.invoiceNo }, { $set: inv });
    console.log(`Updated invoice ${inv.invoiceNo}`);
  } else {
    await Invoice.create(inv);
    console.log(`Created invoice ${inv.invoiceNo}`);
  }
}

(async () => {
  try {
    await upsertInvoice(baseInvoice(t1, 'Alpha Traders', ''));
    await upsertInvoice(baseInvoice(t2, 'Beta Supplies', 'Maharashtra'));
    console.log('Done');
    process.exit(0);
  } catch (e) {
    console.error('Error creating test invoices', e);
    process.exit(1);
  }
})();
