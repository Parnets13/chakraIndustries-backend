
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TallyConfig from '../models/TallyConfig.js';

dotenv.config();

async function update() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const config = await TallyConfig.findOneAndUpdate(
      {},
      {
        $set: {
          tallyLocalUrl: '',
          // Keep other fields as is!
        }
      },
      { new: true, upsert: true }
    );

    console.log('✅ Updated TallyConfig:');
    console.log(JSON.stringify(config, null, 2));

    await mongoose.disconnect();
    process.exit(0);
  } catch (e) {
    console.error('❌ Error:', e);
    process.exit(1);
  }
}

update();
