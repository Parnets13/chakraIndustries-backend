/**
 * Renormalize tallyVoucher for all unsynced invoices — picks up new ship-to extraction logic.
 */
import 'dotenv/config';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import mongoose from 'mongoose';

await connectDB();
console.log('✓ Connected to MongoDB');

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();
const periodEnd = cfg?.tallyPeriodEnd || null;
console.log(`Period end: ${periodEnd || '(none)'}`);

const invoices = await Invoice.find({
  source: { $nin: ['Tally', 'tally'] },
}).lean();

console.log(`Found ${invoices.length} total invoices to renormalize\n`);

let updated = 0, skipped = 0, errors = 0;

for (const inv of invoices) {
  try {
    const enrichedItems = await Promise.all((inv.items || []).map(async item => {
      const im = item.itemId ? await ItemMaster.findById(item.itemId).lean() : null;
      return { ...item, hsn: item.hsn || im?.hsn || '', tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '' };
    }));

    const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd });
    await Invoice.findByIdAndUpdate(inv._id, { $set: { tallyVoucher: tv } });
    updated++;

    // Show ship-to for first 5
    if (updated <= 5) {
      console.log(`${inv.invoiceNo}: shipToName="${tv.shipToName}" pincode="${tv.shipToPincode}" state="${tv.shipToState}"`);
    }
  } catch(e) {
    console.error(`ERROR ${inv.invoiceNo}: ${e.message}`);
    errors++;
  }
}

console.log(`\n✅ Done — updated: ${updated}, errors: ${errors}`);
await mongoose.disconnect();
process.exit(0);
