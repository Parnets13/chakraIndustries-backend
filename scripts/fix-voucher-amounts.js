/**
 * fix-voucher-amounts.js
 *
 * One-time migration: clears the lastSyncedDate for all voucher-type
 * TallySyncState records so the next sync re-fetches every voucher and
 * re-computes amounts + inventoryEntries correctly.
 *
 * Run: node scripts/fix-voucher-amounts.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TallySyncState from '../models/TallySyncState.js';
import TallyVoucher from '../models/TallyVoucher.js';

dotenv.config();

const VOUCHER_TYPES = ['Vouchers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra', 'Debit Note', 'Credit Note'];

async function run() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // 1. Report current state
    const total   = await TallyVoucher.countDocuments({});
    const zeroAmt = await TallyVoucher.countDocuments({ amount: { $lte: 0 } });
    const noItems = await TallyVoucher.countDocuments({ inventoryEntries: { $size: 0 }, voucherType: { $in: ['Sales', 'Purchase'] } });
    console.log(`📊 Total vouchers: ${total}`);
    console.log(`⚠️  Zero-amount vouchers: ${zeroAmt}`);
    console.log(`⚠️  Sales/Purchase with no items: ${noItems}`);

    // 2. Reset sync state so full re-fetch runs on next sync
    const result = await TallySyncState.updateMany(
      { entityType: { $in: VOUCHER_TYPES } },
      { $set: { lastSyncedDate: null, syncStatus: 'idle', lastCompletedChunkIndex: -1, chunks: [] } }
    );
    console.log(`\n✅ Reset sync state for ${result.modifiedCount} voucher entity types.`);
    console.log('Next step: Go to Tally → Import tab and run a Full Sync.');
    console.log('The parser will now correctly read ALLINVENTORYENTRIES.LIST and compute amounts.\n');

    process.exit(0);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

run();
