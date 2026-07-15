#!/usr/bin/env node
/**
 * test-normalize-biw01.js
 * Test normalizeToTallyVoucher on invoice BIW01
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

dotenv.config();

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    const biw01 = await Invoice.findOne({ invoiceNo: 'BIW01' }).lean();
    if (!biw01) {
      console.error('✗ BIW01 not found in Invoice collection');
      process.exit(1);
    }
    console.log('✓ Found BIW01');

    const itemNames = (biw01.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean);
    const itemMasters = itemNames.length
      ? await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn tallySalesLedger').lean()
      : [];
    const masterMap = new Map(itemMasters.map(m => [m.name, m]));
    const enrichedItems = (biw01.items || []).map(item => {
      const name = (item.description || item.name || '').trim();
      const im = masterMap.get(name);
      return { ...item, hsn: item.hsn || im?.hsn || '', tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '' };
    });

    console.log('\nCalling normalizeToTallyVoucher...');
    const tv = normalizeToTallyVoucher({ ...biw01, items: enrichedItems }, {});
    console.log('✓ Success!');
    console.log('Result:', JSON.stringify(tv, null, 2));

    await mongoose.disconnect();
    console.log('\n✓ Done');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
