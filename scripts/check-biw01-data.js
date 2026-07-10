#!/usr/bin/env node
/**
 * check-biw01-data.js
 * Quick diagnostic: verify BIW01 invoice has all required fields for Tally export
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';

dotenv.config();

async function main() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    // Find BIW01
    const biw01 = await Invoice.findOne({ invoiceNo: 'BIW01' }).lean();
    if (!biw01) {
      console.error('✗ BIW01 not found in Invoice collection');
      process.exit(1);
    }

    console.log('\n=== BIW01 INVOICE DATA ===');
    console.log('Invoice Number:', biw01.invoiceNo);
    console.log('Party Name:', biw01.partyName || '(MISSING)');
    console.log('Invoice Date:', biw01.invoiceDate);
    console.log('PO Reference:', biw01.buyersOrderNo || biw01.purchaseOrderRef || '(none)');
    console.log('PO Date:', biw01.poDate || '(none)');
    console.log('Grand Total:', biw01.grandTotal);
    console.log('CGST Total:', biw01.cgstTotal);
    console.log('SGST Total:', biw01.sgstTotal);
    console.log('IGST Total:', biw01.igstTotal);
    console.log('Source:', biw01.source);
    console.log('Tally Sync:', biw01.tallySync);
    console.log('Status:', biw01.status);

    console.log('\n=== ITEMS ===');
    (biw01.items || []).forEach((item, i) => {
      console.log(`\nItem ${i + 1}:`);
      console.log('  Name/Description:', item.description || item.name || '(MISSING)');
      console.log('  Quantity:', item.qty);
      console.log('  Rate:', item.rate);
      console.log('  Unit:', item.unit);
      console.log('  Amount/Basic:', item.amount || item.basic);
      console.log('  HSN:', item.hsn || '(none)');
      console.log('  CGST:', item.cgst);
      console.log('  SGST:', item.sgst);
      console.log('  IGST:', item.igst);
      console.log('  tallySalesLedger:', item.tallySalesLedger || '(MISSING)');
    });

    // Check ItemMaster for these items
    console.log('\n=== ITEM MASTER CHECK ===');
    const itemNames = (biw01.items || []).map(i => (i.description || i.name || '').trim()).filter(Boolean);
    const masters = await ItemMaster.find({ name: { $in: itemNames } }).lean();
    console.log(`Found ${masters.length} / ${itemNames.length} items in Item Master`);
    
    masters.forEach(m => {
      console.log(`\n  "${m.name}":`);
      console.log('    SKU:', m.sku);
      console.log('    HSN:', m.hsn || '(none)');
      console.log('    tallySalesLedger:', m.tallySalesLedger || '(MISSING)');
      console.log('    GST:', m.gst);
      console.log('    Unit:', m.unit);
    });

    // Check tallyVoucher sub-document
    console.log('\n=== TALLY VOUCHER SUB-DOCUMENT ===');
    if (biw01.tallyVoucher) {
      const tv = biw01.tallyVoucher;
      console.log('Voucher Number:', tv.voucherNumber);
      console.log('Party Ledger:', tv.partyLedgerName);
      console.log('Date:', tv.date);
      console.log('Buyers Order No:', tv.buyersOrderNo || '(none)');
      console.log('PO Date:', tv.poDate || '(none)');
      console.log('Grand Total:', tv._grandTotal);
      console.log('Sales Base:', tv._salesBase);
      console.log('Use Inventory:', tv._useInventory);
      console.log('Ledger Entries:', tv.allLedgerEntries?.length || 0);
      console.log('Inventory Entries:', tv.allInventoryEntries?.length || 0);
      console.log('\nNarration Preview (first 200 chars):');
      console.log((tv.narration || '').slice(0, 200));
      
      if (tv.allLedgerEntries?.length) {
        console.log('\nLedger Entries:');
        tv.allLedgerEntries.forEach((le, i) => {
          console.log(`  ${i + 1}. ${le.ledgerName}: amount=${le.amount} isDeemedPositive=${le.isDeemedPositive}`);
        });
      }
      
      if (tv.allInventoryEntries?.length) {
        console.log('\nInventory Entries:');
        tv.allInventoryEntries.forEach((ie, i) => {
          console.log(`  ${i + 1}. ${ie.stockItemName}: qty=${ie.actualQty} rate=${ie.rate} amount=${ie.amount}`);
          console.log(`       gstLedgerSource="${ie.gstLedgerSource}"`);
        });
      }
    } else {
      console.log('(NO TALLY VOUCHER SUB-DOCUMENT — invoice needs re-normalization)');
    }

    await mongoose.disconnect();
    console.log('\n✓ Done');
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
