
import dotenv from 'dotenv';
import { pullEntityFromTally } from '../services/tallyFetchEngine.js';
import connectDB from '../config/database.js';

dotenv.config();

async function test() {
  await connectDB();
  console.log('Testing pullEntityFromTally for Ledgers...');
  const result = await pullEntityFromTally('Ledgers', { forceRefresh: true });
  console.log('Ledger result:', result);
  
  console.log('\nTesting pullEntityFromTally for Items...');
  const itemsResult = await pullEntityFromTally('Items', { forceRefresh: true });
  console.log('Items result:', itemsResult);

  console.log('\nDone!');
  process.exit(0);
}

test().catch(err => {
  console.error(err);
  process.exit(1);
});
