/**
 * drop-dealer-mobile-unique-index.js
 *
 * Run this ONCE to remove the old unique index on dealers.mobile
 * so that multiple registrations with the same mobile number are allowed.
 *
 * Usage:  node scripts/drop-dealer-mobile-unique-index.js
 */

import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI;

if (!MONGO_URI) {
  console.error('❌ MONGO_URI not found in .env');
  process.exit(1);
}

async function run() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const collection = mongoose.connection.collection('dealers');
    const indexes = await collection.indexes();
    console.log('📋 Current indexes on dealers collection:');
    indexes.forEach(idx => console.log('  ', JSON.stringify(idx)));

    // Find any unique index on the mobile field
    const mobileUniqueIndex = indexes.find(
      idx => idx.unique && idx.key && idx.key.mobile !== undefined
    );

    if (mobileUniqueIndex) {
      console.log(`\n🗑️  Dropping unique index: "${mobileUniqueIndex.name}"`);
      await collection.dropIndex(mobileUniqueIndex.name);
      console.log('✅ Unique index on mobile dropped successfully');
    } else {
      console.log('\n✅ No unique index found on mobile — nothing to drop');
    }

    // Also drop unique index on dealerCode if it exists (was sparse+unique before)
    const dealerCodeUniqueIndex = indexes.find(
      idx => idx.unique && idx.key && idx.key.dealerCode !== undefined
    );

    if (dealerCodeUniqueIndex) {
      console.log(`\n🗑️  Dropping unique index on dealerCode: "${dealerCodeUniqueIndex.name}"`);
      await collection.dropIndex(dealerCodeUniqueIndex.name);
      console.log('✅ Unique index on dealerCode dropped successfully');
    }

    console.log('\n🎉 Done. Multiple registrations with same mobile/email are now allowed.');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
