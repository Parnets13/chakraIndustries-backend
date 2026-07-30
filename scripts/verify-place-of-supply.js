/**
 * verify-place-of-supply.js
 * 
 * Verifies that Place of Supply matches Bill To State for all invoices
 * according to GST and e-Invoice rules
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

dotenv.config();

async function verifyPlaceOfSupply() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Get all invoices with tally voucher data
    const invoices = await Invoice.find({
      'tallyVoucher.date': { $exists: true }
    }).select('invoiceNo billToState partyState shipToState tallyVoucher').lean();

    console.log(`Found ${invoices.length} invoices with Tally voucher data\n`);

    let correctCount = 0;
    let incorrectCount = 0;
    const issues = [];

    for (const inv of invoices) {
      const billToState = inv.billToState || inv.partyState || '';
      const shipToState = inv.shipToState || '';
      const voucherState = inv.tallyVoucher?.partyState || '';

      // Place of Supply should be Bill To State, NOT Ship To State
      const expectedPlaceOfSupply = billToState;
      
      // Check if the current voucher has correct state
      if (voucherState === expectedPlaceOfSupply) {
        correctCount++;
      } else {
        incorrectCount++;
        issues.push({
          invoiceNo: inv.invoiceNo,
          expectedPlaceOfSupply,
          currentVoucherState: voucherState,
          billToState,
          shipToState
        });
      }
    }

    console.log('=== VERIFICATION RESULTS ===\n');
    console.log(`✓ Correct: ${correctCount}`);
    console.log(`✗ Incorrect: ${incorrectCount}\n`);

    if (issues.length > 0) {
      console.log('=== INVOICES WITH INCORRECT PLACE OF SUPPLY ===\n');
      issues.forEach(issue => {
        console.log(`Invoice: ${issue.invoiceNo}`);
        console.log(`  Expected Place of Supply (Bill To State): ${issue.expectedPlaceOfSupply}`);
        console.log(`  Current Voucher State: ${issue.currentVoucherState}`);
        console.log(`  Bill To State: ${issue.billToState}`);
        console.log(`  Ship To State: ${issue.shipToState}`);
        console.log('');
      });

      console.log('\n=== RECOMMENDATION ===');
      console.log('These invoices need to be re-exported with the corrected Place of Supply.');
      console.log('The fix has been applied to tallyExportService.js');
      console.log('Use the re-export functionality to update these invoices in Tally.');
    } else {
      console.log('✓ All invoices have correct Place of Supply!');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n✓ Disconnected from MongoDB');
  }
}

verifyPlaceOfSupply();
