/**
 * set-local-tally.js
 * Run this once to switch to direct Tally mode (no connector needed).
 * Use when running backend locally with Tally on the same machine.
 *
 * Usage: node scripts/set-local-tally.js
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);

const cfg = await TallyConfig.findOneAndUpdate(
  {},
  {
    $set: {
      useConnector:     false,
      tallyLocalUrl:    'http://localhost:9000',
      connectionStatus: 'Unknown',
    },
  },
  { sort: { _id: 1 }, upsert: true, new: true }
);

console.log('✅ TallyConfig updated for LOCAL mode (no connector):');
console.log('   useConnector  :', cfg.useConnector);
console.log('   tallyLocalUrl :', cfg.tallyLocalUrl);
console.log('   companyName   :', cfg.companyName || '(not set)');
console.log('');
console.log('Tally will now be called directly at http://localhost:9000');
console.log('No connector needed. Restart your backend server.');

await mongoose.disconnect();
