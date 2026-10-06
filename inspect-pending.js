// inspect-pending.js — READ ONLY. Dumps key fields of the 20 pending invoices
// to find what Tally is rejecting (EXCEPTIONS=10, no diagnostic).
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';

const PENDING = ['BIW2460','BIW2461','BIW2462','BIW2459','BIW2455','BIW2456','BIW2457','BIW2458','BIW2453','BIW2454','BIW2441','BIW2442','BIW2440','BIW2437','BIW2438','BIW2435','BIW2436','BIW2434','BIW2433','BIW2432'];

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const invs = await Invoice.find({ invoiceNo: { $in: PENDING } }).lean();

  invs.forEach(inv => {
    console.log(`\n═══ ${inv.invoiceNo} ═══`);
    console.log(`  party:         ${inv.partyName}`);
    console.log(`  partyGST:      "${inv.partyGST || inv.billToGST || ''}"`);
    console.log(`  billToState:   "${inv.billToState || inv.partyState || ''}"`);
    console.log(`  shipToName:    "${inv.shipToName || ''}"`);
    console.log(`  shipToState:   "${inv.shipToState || ''}"`);
    console.log(`  shipToGST:     "${inv.shipToGST || ''}"`);
    console.log(`  shipToPincode: "${inv.shipToPincode || ''}"`);
    console.log(`  shipToAddress: "${(inv.shipToAddress || '').slice(0, 80)}"`);
    console.log(`  grandTotal:    ${inv.grandTotal || inv.totalAmount}`);
    (inv.items || []).forEach((it, i) => {
      console.log(`  item[${i+1}]: "${(it.description||it.name||'').slice(0,35)}" hsn="${it.hsn||''}" base=${it.basic||it.amount} cgst=${it.cgst} sgst=${it.sgst} igst=${it.igst} ledger="${it.tallySalesLedger||''}"`);
    });
  });

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
