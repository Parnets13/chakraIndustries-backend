/**
 * parse-address-to-city-state.js
 * 
 * Extracts city and state from Ship To addresses that have format:
 * "VIZIANAGARAMAP535081" → city=Vizianagaram, state=Andhra Pradesh, pincode=535081
 * "NANDYALAP518501" → city=Nandyal, state=Andhra Pradesh, pincode=518501
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Invoice from '../models/Invoice.js';

dotenv.config();

// Pincode-to-state mapping
const PINCODE_STATE_MAP = {
  515: 'Andhra Pradesh', 516: 'Andhra Pradesh', 517: 'Andhra Pradesh', 518: 'Andhra Pradesh',
  520: 'Andhra Pradesh', 521: 'Andhra Pradesh', 522: 'Andhra Pradesh', 523: 'Andhra Pradesh',
  524: 'Andhra Pradesh', 525: 'Andhra Pradesh', 526: 'Andhra Pradesh', 527: 'Andhra Pradesh',
  530: 'Andhra Pradesh', 531: 'Andhra Pradesh', 532: 'Andhra Pradesh', 533: 'Andhra Pradesh',
  534: 'Andhra Pradesh', 535: 'Andhra Pradesh',
  
  560: 'Karnataka', 561: 'Karnataka', 562: 'Karnataka', 563: 'Karnataka', 564: 'Karnataka',
  565: 'Karnataka', 570: 'Karnataka', 571: 'Karnataka', 573: 'Karnataka', 574: 'Karnataka',
  575: 'Karnataka', 576: 'Karnataka', 577: 'Karnataka', 581: 'Karnataka', 583: 'Karnataka',
  585: 'Karnataka', 586: 'Karnataka', 587: 'Karnataka', 590: 'Karnataka', 591: 'Karnataka',
};

// Common city name patterns in addresses
const CITY_PATTERNS = [
  'VIZIANAGARAM', 'NANDYAL', 'ANANTAPUR', 'KADAPA', 'MALIKIPURAM', 
  'GUNTUR', 'NARSIPATNAM', 'JAMMALAMADUGU', 'PULIVENDULA', 'SOMPETA',
  'BANGALORE', 'BENGALURU', 'MYSORE', 'HUBLI', 'CHENNAI', 'HYDERABAD',
  'MUMBAI', 'DELHI', 'KOLKATA', 'PUNE', 'AHMEDABAD', 'JAIPUR'
];

/**
 * Extract city, state, pincode from combined address string
 * Format: "CITYNAME[State_Code][Pincode]"
 * Example: "VIZIANAGARAMAP535081" → { city: 'Vizianagaram', state: 'Andhra Pradesh', pincode: '535081' }
 */
function parseAddress(address) {
  if (!address) return {};
  
  const text = address.toUpperCase().trim();
  
  // Extract 6-digit pincode
  const pincodeMatch = text.match(/(\d{6})/);
  const pincode = pincodeMatch ? pincodeMatch[1] : null;
  
  // Derive state from pincode
  let state = null;
  if (pincode) {
    const prefix = parseInt(pincode.substring(0, 3));
    state = PINCODE_STATE_MAP[prefix];
  }
  
  // Extract city name (before state code or pincode)
  let city = null;
  
  // Try to match known city patterns
  for (const pattern of CITY_PATTERNS) {
    if (text.includes(pattern)) {
      // Clean up the match
      city = pattern.charAt(0) + pattern.slice(1).toLowerCase();
      break;
    }
  }
  
  // If no match, try to extract from format: CITYAP535081
  if (!city && pincode) {
    // Remove pincode and state code suffix (last 8-10 chars typically)
    const cleaned = text.replace(/AP\d{6}$/, '').replace(/\d{6}$/, '').trim();
    if (cleaned.length >= 3) {
      // Proper case the city name
      city = cleaned.charAt(0) + cleaned.slice(1).toLowerCase();
    }
  }
  
  return { city, state, pincode };
}

async function parseAddressToCityState() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✓ Connected to MongoDB\n');

    const invoices = await Invoice.find({});
    console.log(`Found ${invoices.length} invoices\n`);

    let billToFixed = 0;
    let shipToFixed = 0;

    for (const inv of invoices) {
      let modified = false;

      // Fix Bill To city/state from address if missing
      if (!inv.billToCity || !inv.billToState) {
        const billToAddress = inv.billToAddress || inv.partyAddress || '';
        const parsed = parseAddress(billToAddress);
        
        if (!inv.billToCity && parsed.city) {
          inv.billToCity = parsed.city;
          if (inv.tallyVoucher) inv.tallyVoucher.billToCity = parsed.city;
          modified = true;
        }
        if (!inv.billToState && parsed.state) {
          inv.billToState = parsed.state;
          if (inv.tallyVoucher) inv.tallyVoucher.billToState = parsed.state;
          modified = true;
        }
        if (modified) billToFixed++;
      }

      // Fix Ship To city/state from address if missing
      if (inv.shipToName && (!inv.shipToCity || !inv.shipToState)) {
        const shipToAddress = (inv.shipToAddress || '') + ' ' + (inv.shipToAddress2 || '');
        const parsed = parseAddress(shipToAddress);
        
        if (!inv.shipToCity && parsed.city) {
          inv.shipToCity = parsed.city;
          if (inv.tallyVoucher) inv.tallyVoucher.shipToCity = parsed.city;
          modified = true;
        }
        if (!inv.shipToState && parsed.state) {
          inv.shipToState = parsed.state;
          if (inv.tallyVoucher) inv.tallyVoucher.shipToState = parsed.state;
          modified = true;
        }
        if (!inv.shipToPincode && parsed.pincode) {
          inv.shipToPincode = parsed.pincode;
          if (inv.tallyVoucher) inv.tallyVoucher.shipToPincode = parsed.pincode;
          modified = true;
        }
        if (modified) shipToFixed++;
      }

      if (modified) {
        await inv.save();
        console.log(`✓ Fixed ${inv.invoiceNo}: billTo=${inv.billToCity || '?'}, shipTo=${inv.shipToCity || '?'}`);
      }
    }

    console.log('\n=== SUMMARY ===\n');
    console.log(`✓ Bill To fixed: ${billToFixed}`);
    console.log(`✓ Ship To fixed: ${shipToFixed}\n`);

    console.log('=== NEXT STEPS ===');
    console.log('1. Reset invoice sync flags');
    console.log('2. Re-export to Tally');
    console.log('3. Update Excel template with separate City and State columns\n');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    console.log('✓ Disconnected from MongoDB');
  }
}

parseAddressToCityState();
