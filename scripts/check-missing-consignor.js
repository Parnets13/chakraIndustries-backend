/**
 * check-missing-consignor.js
 * 
 * Checks which invoices in MongoDB are missing Consignor fields
 * (these will fail e-Invoice validation in Tally)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

dotenv.config();

async function checkMissingConsignor() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Get all invoices that have been synced to Tally
    const invoices = await Invoice.find({
      tallySync: true
    }).select('invoiceNo tallyVoucher').lean();

    console.log(`Found ${invoices.length} synced invoices\n`);

    let missingConsignor = 0;
    let missingBillToPlace = 0;
    let missingConsigneePlace = 0;
    const issues = [];

    for (const inv of invoices) {
      const v = inv.tallyVoucher || {};
      
      // Check for missing fields that cause validation errors
      const checks = {
        hasConsignorName: !!v.companyAddress,  // proxy for consignor block
        hasBillToCity: !!(v.billToCity || v.partyCity),
        hasShipToCity: !!(v.shipToCity)
      };

      const problems = [];
      if (!checks.hasConsignorName) {
        missingConsignor++;
        problems.push('Missing Consignor block');
      }
      if (!checks.hasBillToCity) {
        missingBillToPlace++;
        problems.push('Missing Bill To city (Place field will be wrong)');
      }
      if (v.shipToName && !checks.hasShipToCity) {
        missingConsigneePlace++;
        problems.push('Missing Consignee city (Place field will be wrong)');
      }

      if (problems.length > 0) {
        issues.push({
          invoiceNo: inv.invoiceNo,
          problems
        });
      }
    }

    console.log('=== SUMMARY ===\n');
    console.log(`Invoices missing Consignor block: ${missingConsignor}`);
    console.log(`Invoices missing Bill To city: ${missingBillToPlace}`);
    console.log(`Invoices missing Consignee city: ${missingConsigneePlace}`);
    console.log(`\nTotal invoices with issues: ${issues.length}\n`);

    if (issues.length > 0) {
      console.log('=== AFFECTED INVOICES (First 20) ===\n');
      issues.slice(0, 20).forEach(issue => {
        console.log(`Invoice: ${issue.invoiceNo}`);
        issue.problems.forEach(p => console.log(`  ❌ ${p}`));
        console.log('');
      });

      if (issues.length > 20) {
        console.log(`... and ${issues.length - 20} more\n`);
      }

      console.log('=== RECOMMENDATION ===');
      console.log('1. Go to ERP → Tally Settings → Re-export Sales Invoices');
      console.log('2. Click "Reset Sync Flags" (this will mark all as not synced)');
      console.log('3. Run Export to Tally → Sales Invoices');
      console.log('4. New export will include Consignor block + correct Place fields');
      console.log('\nNote: Tally will use ACTION="Alter" to update existing vouchers.');
      console.log('No need to manually delete from Tally Day Book.\n');
    } else {
      console.log('✓ All synced invoices look good!\n');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

checkMissingConsignor();
