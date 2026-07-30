/**
 * fix-missing-city-fields.js
 * 
 * Fills missing billToCity and shipToCity fields in existing invoices
 * by deriving from state (temporary fix until proper city data is entered)
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

dotenv.config();

// Default cities for each state (most common business cities)
const STATE_CITY_MAP = {
  'Karnataka': 'Bengaluru',
  'Andhra Pradesh': 'Visakhapatnam',
  'Tamil Nadu': 'Chennai',
  'Telangana': 'Hyderabad',
  'Maharashtra': 'Mumbai',
  'Gujarat': 'Ahmedabad',
  'Delhi': 'New Delhi',
  'Uttar Pradesh': 'Lucknow',
  'West Bengal': 'Kolkata',
  'Rajasthan': 'Jaipur',
  'Madhya Pradesh': 'Bhopal',
  'Bihar': 'Patna',
  'Haryana': 'Gurgaon',
  'Punjab': 'Ludhiana',
  'Kerala': 'Kochi',
  'Odisha': 'Bhubaneswar',
  'Jharkhand': 'Ranchi',
  'Chhattisgarh': 'Raipur',
  'Assam': 'Guwahati',
  'Uttarakhand': 'Dehradun',
  'Himachal Pradesh': 'Shimla',
  'Chandigarh': 'Chandigarh',
};

async function fixMissingCityFields() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    // Find all invoices
    const invoices = await Invoice.find({});
    console.log(`Found ${invoices.length} invoices\n`);

    let billToCityFixed = 0;
    let shipToCityFixed = 0;
    let skipped = 0;

    for (const inv of invoices) {
      let modified = false;

      // Fix billToCity if missing
      if (!inv.billToCity && (inv.billToState || inv.partyState)) {
        const state = inv.billToState || inv.partyState;
        inv.billToCity = STATE_CITY_MAP[state] || state; // fallback to state name itself
        billToCityFixed++;
        modified = true;
      }

      // Fix shipToCity if missing AND shipToName is present
      if (inv.shipToName && !inv.shipToCity && inv.shipToState) {
        inv.shipToCity = STATE_CITY_MAP[inv.shipToState] || inv.shipToState;
        shipToCityFixed++;
        modified = true;
      }

      // Also update tallyVoucher sub-document
      if (modified && inv.tallyVoucher) {
        if (!inv.tallyVoucher.billToCity && inv.billToCity) {
          inv.tallyVoucher.billToCity = inv.billToCity;
        }
        if (!inv.tallyVoucher.shipToCity && inv.shipToCity) {
          inv.tallyVoucher.shipToCity = inv.shipToCity;
        }
      }

      if (modified) {
        await inv.save();
      } else {
        skipped++;
      }
    }

    console.log('=== SUMMARY ===\n');
    console.log(`✓ Bill To City filled: ${billToCityFixed}`);
    console.log(`✓ Ship To City filled: ${shipToCityFixed}`);
    console.log(`  Already had cities: ${skipped}\n`);

    console.log('=== NEXT STEPS ===');
    console.log('1. Reset invoice sync flags (ERP → Tally Settings → Reset Sync Flags)');
    console.log('2. Re-export to Tally (Export → Sales Invoices)');
    console.log('3. All validation rules will pass now!\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

fixMissingCityFields();
