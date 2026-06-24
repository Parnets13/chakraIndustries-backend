/**
 * fixTallyLocalUrl.js
 * Sets tallyLocalUrl to http://localhost:9000 for local Tally Prime.
 * Run: node scripts/fixTallyLocalUrl.js
 */
import dotenv from 'dotenv';
import mongoose from 'mongoose';

dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
console.log('Connected to MongoDB');

const result = await mongoose.connection.db.collection('tallyconfigs').updateOne(
  {},
  {
    $set: {
      tallyLocalUrl: 'http://localhost:9000',
      companyName: 'SRI CHAKRA INDUSTRIES',
      port: '9000',
      connectionStatus: 'Unknown',
    }
  },
  { upsert: true }
);

const cfg = await mongoose.connection.db.collection('tallyconfigs').findOne({});
console.log('--- Updated TallyConfig ---');
console.log('tallyLocalUrl :', cfg.tallyLocalUrl);
console.log('companyName   :', cfg.companyName);
console.log('port          :', cfg.port);
console.log('serverUrl     :', cfg.serverUrl);
console.log('Modified      :', result.modifiedCount);

await mongoose.disconnect();
console.log('Done ✓');
