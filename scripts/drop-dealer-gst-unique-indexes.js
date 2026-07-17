/**
 * drop-dealer-gst-unique-indexes.js
 *
 * Run this ONCE to remove unique indexes on dealers.gstNumber and dealers.gstin
 * to prevent "gstNumber is already registered" errors.
 *
 * Usage:  node scripts/drop-dealer-gst-unique-indexes.js
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

    // Find unique index on gstNumber
    const gstNumberIndex = indexes.find(
      idx => idx.unique && idx.key && idx.key.gstNumber !== undefined
    );

    if (gstNumberIndex) {
      console.log(`\n🗑️  Dropping unique index on gstNumber: "${gstNumberIndex.name}"`);
      await collection.dropIndex(gstNumberIndex.name);
      console.log('✅ Unique index on gstNumber dropped successfully');
    } else {
      console.log('\n✅ No unique index found on gstNumber');
    }

    console.log('\n🎉 Done.');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

run();
