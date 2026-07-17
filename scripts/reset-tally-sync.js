#!/usr/bin/env node
/**
 * reset-tally-sync.js
 * Clears tallySync=true on invoices that were marked synced by the dedup
 * path (incorrectly, because the invoice exists in Tally but was not
 * exported by ERP — it was manually created in Tally).
 *
 * Run this once to unblock stuck invoices:
 *   node scripts/reset-tally-sync.js
 *
 * Or to reset a specific invoice:
 *   node scripts/reset-tally-sync.js BIW01
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

dotenv.config();

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✓ Connected to MongoDB');

  const invoiceNo = process.argv[2];

  if (invoiceNo) {
    // Reset specific invoice
    const result = await Invoice.updateOne(
      { invoiceNo },
      { $set: { tallySync: false }, $unset: { tallySyncAt: 1 } }
    );
    console.log(`Reset tallySync for ${invoiceNo}: matched=${result.matchedCount} modified=${result.modifiedCount}`);
  } else {
    // Reset ALL invoices with tallySync=true that are NOT from Tally source
    const result = await Invoice.updateMany(
      {
        tallySync: true,
        source: { $nin: ['Tally', 'tally'] },
        status: { $nin: ['Cancelled'] },
      },
      { $set: { tallySync: false }, $unset: { tallySyncAt: 1 } }
    );
    console.log(`Reset tallySync on ${result.modifiedCount} ERP invoices`);
    console.log('These will be re-exported on the next export run.');
  }

  await mongoose.disconnect();
  console.log('Done');
}

main().catch(err => { console.error(err); process.exit(1); });
