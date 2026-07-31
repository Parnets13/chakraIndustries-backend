/**
 * dump-biw101-xml.js
 * Fetches BIW101 from DB, serializes it to Tally XML, and prints it.
 * This shows EXACTLY what Tally receives — copy/paste output to diagnose tax mismatch.
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

import Invoice from '../models/Invoice.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  console.log('✓ Connected\n');

  const inv = await Invoice.findOne({ invoiceNo: 'BIW101' }).lean();
  if (!inv) { console.log('❌ BIW101 not found'); process.exit(1); }

  const tv = inv.tallyVoucher;
  if (!tv) { console.log('❌ No tallyVoucher on BIW101'); process.exit(1); }

  console.log('=== INVOICE DATA ===');
  console.log('Items:');
  (inv.items || []).forEach(it => {
    console.log(`  ${it.description}: qty=${it.qty} rate=${it.rate} basic=${it.basic} cgst=${it.cgst} sgst=${it.sgst} igst=${it.igst} taxRate=${it.taxRate}`);
  });
  console.log('\n=== TALLY VOUCHER STORED ===');
  console.log('Ledger Entries:');
  (tv.allLedgerEntries || []).forEach(le => {
    console.log(`  ${le.ledgerName}: amount=${le.amount} rateOfInvoiceTax=${le.rateOfInvoiceTax || '(none)'}`);
  });
  console.log('\nInventory Entries:');
  (tv.allInventoryEntries || []).forEach(ie => {
    console.log(`  ${ie.stockItemName}: amount=${ie.amount}`);
    console.log(`  rateDetails:`, JSON.stringify(ie.rateDetails || []));
    console.log(`  gstOverrideTaxability: ${ie.gstOverrideTaxability}`);
    console.log(`  gstOverrideSupplyType: ${ie.gstOverrideSupplyType}`);
  });

  const cfg = { companyName: 'SRI CHAKRA INDUSTRIES', gstin: '29ABWFS0002M1ZR', state: 'Karnataka', city: 'Bengaluru', pincode: '560039', address: '13/14, Azeez Sait Industrial Estate, Nayandahalli, Mysore Road, Bangalore-560039' };

  console.log('\n=== GENERATED XML ===');
  const xml = serializeTallyVoucher(tv, cfg, 'Create', '');
  console.log(xml);

  await mongoose.disconnect();
}

main().catch(console.error);
