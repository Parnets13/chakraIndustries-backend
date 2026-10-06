// compare-fail-pass.js — READ ONLY. Compares a FAILED invoice vs a PASSED one
// to find the structural difference causing EXCEPTIONS=10.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';

async function dump(inv, label) {
  console.log(`\n═══ ${label}: ${inv.invoiceNo} (synced=${inv.tallySync}) ═══`);
  const tv = normalizeToTallyVoucher(inv, {});
  console.log(`  party: ${tv.partyLedgerName}`);
  console.log(`  grandTotal: ${tv._grandTotal}  cgst:${tv._totalCGST} sgst:${tv._totalSGST} igst:${tv._totalIGST}`);
  (tv.allInventoryEntries || []).forEach((ie, i) => {
    console.log(`  item[${i+1}] "${ie.stockItemName}"`);
    console.log(`     amount=${ie.amount} rate=${ie.rate}`);
    console.log(`     gstLedgerSource="${ie.gstLedgerSource}"  hsn="${ie.gstHsnName}"`);
    console.log(`     acctAlloc ledger="${ie.accountingAllocations?.[0]?.ledgerName}"`);
    const rd = (ie.rateDetails||[]).filter(r=>r.gstRate>0).map(r=>`${r.gstRateDutyHead}:${r.gstRate}`).join(', ');
    console.log(`     rateDetails: ${rd}`);
  });
  (tv.allLedgerEntries || []).forEach(le => {
    console.log(`  ledger "${le.ledgerName}" amount=${le.amount}`);
  });
}

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });

  const failed = await Invoice.findOne({ invoiceNo: 'BIW2432' }).lean();
  const passed = await Invoice.findOne({ invoiceNo: 'BIW2525', tallySync: true }).lean()
            || await Invoice.findOne({ tallySync: true }).lean();

  if (failed) await dump(failed, 'FAILED');
  if (passed) await dump(passed, 'PASSED');

  // Also list distinct sales ledgers used by the 20 failed vs the synced ones
  const PENDING = ['BIW2432','BIW2433','BIW2434','BIW2435','BIW2436','BIW2437','BIW2438','BIW2440','BIW2441','BIW2442','BIW2453','BIW2454','BIW2455','BIW2456','BIW2457','BIW2458','BIW2459','BIW2460','BIW2461','BIW2462'];
  const failedInvs = await Invoice.find({ invoiceNo: { $in: PENDING } }).lean();
  const syncedInvs = await Invoice.find({ tallySync: true }).lean();

  const ledgersOf = (list) => {
    const s = new Set();
    list.forEach(inv => (inv.items||[]).forEach(it => s.add((it.tallySalesLedger||'(empty)').trim() || '(empty)')));
    return s;
  };
  const failLedgers = ledgersOf(failedInvs);
  const passLedgers = ledgersOf(syncedInvs);

  console.log('\n═══ Sales ledgers used by FAILED invoices ═══');
  [...failLedgers].forEach(l => {
    const inPass = passLedgers.has(l);
    console.log(`  "${l}"  ${inPass ? '(also in passed)' : '← ONLY in failed'}`);
  });

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
