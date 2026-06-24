
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { pullEntityFromTally } from '../services/tallyFetchEngine.js';

dotenv.config();

async function testPull() {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log('=== Testing pullEntityFromTally("Items") ===');
    const itemsResult = await pullEntityFromTally('Items', { forceChunk: false });
    console.log('Items result:', JSON.stringify(itemsResult, null, 2));

    console.log('\n=== Testing pullEntityFromTally("Ledgers") ===');
    const ledgersResult = await pullEntityFromTally('Ledgers', { forceChunk: false });
    console.log('Ledgers result:', JSON.stringify(ledgersResult, null, 2));

    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error('❌ Error in test pull:', e);
    await mongoose.disconnect();
    process.exit(1);
  }
}

testPull();
