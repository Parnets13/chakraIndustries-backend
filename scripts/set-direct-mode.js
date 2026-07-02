/**
 * set-direct-mode.js
 * Sets useConnector=false and tallyLocalUrl=http://localhost:9000 in TallyConfig.
 * Run this once when testing against local Tally directly.
 *
 * Usage:
 *   node scripts/set-direct-mode.js
 */
import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

console.log('Connecting to MongoDB...');
await mongoose.connect(process.env.MONGO_URI);
console.log('Connected.\n');

// Direct DB update — no model imports that might trigger auto-sync or scheduler
const result = await mongoose.connection.db.collection('tallyconfigs').findOneAndUpdate(
  {},
  {
    $set: {
      useConnector: false,
      tallyLocalUrl: 'http://localhost:9000',
    },
  },
  { sort: { _id: 1 }, returnDocument: 'after', upsert: true }
);

const doc = result?.value || result;
console.log('UPDATED TallyConfig:');
console.log('  useConnector  :', doc?.useConnector);
console.log('  connectorId   :', doc?.connectorId);
console.log('  tallyLocalUrl :', doc?.tallyLocalUrl);
console.log('\n✅ Done. Restart backend and try Export to Tally again.');

await mongoose.disconnect();
process.exit(0);
