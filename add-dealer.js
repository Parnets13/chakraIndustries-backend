/**
 * add-dealer.js
 * Quick script to add a dealer to MongoDB so login works.
 *
 * Usage: node add-dealer.js
 *
 * Edit DEALERS_TO_ADD below to add your own mobile numbers.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from './config/database.js';
import Dealer from './models/Dealer.js';

dotenv.config();

// ─── ADD YOUR DEALERS HERE ────────────────────────────────────────────────────
const DEALERS_TO_ADD = [
  {
    name: 'Rajan Mehta',
    mobile: '9305241794',
    email: 'rajan.mehta@gmail.com',
    zone: 'South',
    isActive: true,
  },
  {
    name: 'Test Dealer',
    mobile: '9999999999',
    email: 'test@chakraindustries.com',
    zone: 'Central',
    isActive: true,
  },
  {
    name: 'Demo Dealer',
    mobile: '8888888888',
    email: 'demo@chakraindustries.com',
    zone: 'North',
    isActive: true,
  },
  // ← Add more dealers here:
  // {
  //   name: 'Your Name',
  //   mobile: 'XXXXXXXXXX',  // 10-digit number
  //   email: 'your@email.com',
  //   zone: 'North',
  //   isActive: true,
  // },
];
// ─────────────────────────────────────────────────────────────────────────────

async function addDealers() {
  try {
    await connectDB();
    console.log('\n═══════════════════════════════════════');
    console.log('  Adding Dealers to MongoDB');
    console.log('═══════════════════════════════════════\n');

    for (const dealerData of DEALERS_TO_ADD) {
      const existing = await Dealer.findOne({ mobile: dealerData.mobile });

      if (existing) {
        console.log(`⏭️  Already exists: ${dealerData.mobile} (${existing.name})`);
        // Ensure isActive is true
        if (!existing.isActive) {
          existing.isActive = true;
          await existing.save();
          console.log(`   ✅ Re-activated dealer`);
        }
        continue;
      }

      const dealer = await Dealer.create(dealerData);
      console.log(`✅ Created: ${dealer.mobile} → ${dealer.name} [${dealer.dealerCode}]`);
    }

    console.log('\n═══════════════════════════════════════');
    console.log('  Done! You can now login with these');
    console.log('  mobile numbers in the dealer app.');
    console.log('═══════════════════════════════════════\n');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

addDealers();
