/**
 * check-biw02-special.js
 * 
 * Checks what's special about BIW-02 that makes it pass validation
 * while other invoices fail
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

dotenv.config();

async function checkBIW02() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Get BIW-02 and a few other invoices for comparison
    const biw02 = await Invoice.findOne({ invoiceNo: 'BIW-02' }).lean();
    const biw01 = await Invoice.findOne({ invoiceNo: 'BIW-01' }).lean();
    const biw03 = await Invoice.findOne({ invoiceNo: 'BIW-03' }).lean();

    if (!biw02) {
      console.log('❌ BIW-02 not found in database');
      return;
    }

    console.log('=== BIW-02 Analysis ===\n');
    console.log('Invoice No:', biw02.invoiceNo);
    console.log('Invoice Date:', biw02.invoiceDate);
    console.log('Party Name:', biw02.partyName);
    
    // Check tallyVoucher structure
    const v = biw02.tallyVoucher || {};
    console.log('\n--- Tally Voucher Fields ---');
    console.log('companyAddress:', v.companyAddress || '(missing)');
    console.log('godownName:', v.godownName || '(missing)');
    console.log('billToCity:', v.billToCity || '(missing)');
    console.log('shipToCity:', v.shipToCity || '(missing)');
    console.log('billToState:', v.billToState || '(missing)');
    console.log('shipToState:', v.shipToState || '(missing)');

    // Check if BIW-02 has Ship To (consignee) data
    console.log('\n--- Ship To (Consignee) Data ---');
    console.log('shipToName:', biw02.shipToName || '(missing)');
    console.log('shipToAddress:', biw02.shipToAddress || '(missing)');
    console.log('shipToCity:', biw02.shipToCity || '(missing)');
    console.log('shipToState:', biw02.shipToState || '(missing)');

    // Compare with BIW-01
    if (biw01) {
      console.log('\n\n=== BIW-01 for Comparison ===\n');
      console.log('Invoice No:', biw01.invoiceNo);
      console.log('Party Name:', biw01.partyName);
      
      const v1 = biw01.tallyVoucher || {};
      console.log('\n--- Tally Voucher Fields ---');
      console.log('companyAddress:', v1.companyAddress || '(missing)');
      console.log('billToCity:', v1.billToCity || '(missing)');
      console.log('shipToCity:', v1.shipToCity || '(missing)');
      
      console.log('\n--- Ship To Data ---');
      console.log('shipToName:', biw01.shipToName || '(missing)');
      console.log('shipToCity:', biw01.shipToCity || '(missing)');
    }

    // Compare with BIW-03
    if (biw03) {
      console.log('\n\n=== BIW-03 for Comparison ===\n');
      console.log('Invoice No:', biw03.invoiceNo);
      console.log('Party Name:', biw03.partyName);
      
      const v3 = biw03.tallyVoucher || {};
      console.log('\n--- Tally Voucher Fields ---');
      console.log('companyAddress:', v3.companyAddress || '(missing)');
      console.log('billToCity:', v3.billToCity || '(missing)');
      console.log('shipToCity:', v3.shipToCity || '(missing)');
      
      console.log('\n--- Ship To Data ---');
      console.log('shipToName:', biw03.shipToName || '(missing)');
      console.log('shipToCity:', biw03.shipToCity || '(missing)');
    }

    console.log('\n\n=== Analysis ===');
    console.log('BIW-02 passes validation because:');
    
    // Theory 1: No Ship To (same as Bill To)
    if (!biw02.shipToName || !biw02.shipToCity) {
      console.log('✓ BIW-02 has NO separate Ship To address');
      console.log('  → Consignee Place validation is skipped (buyer = consignee)');
    }
    
    // Theory 2: Has city fields
    if (v.billToCity || biw02.billToCity) {
      console.log('✓ BIW-02 has Bill To City filled');
      console.log('  → Bill To Place validation passes');
    }

    console.log('\nOther invoices fail because:');
    if (biw01?.shipToName && !biw01?.shipToCity) {
      console.log('❌ They have Ship To Name but NO Ship To City');
      console.log('  → Consignee Place validation fails');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

checkBIW02();
