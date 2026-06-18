
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import TallyConfig from './models/TallyConfig.js';

dotenv.config();

async function checkConfig() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chakraIndustries');
    console.log('Connected to MongoDB');

    const config = await TallyConfig.findOne();
    console.log('Current TallyConfig:', JSON.stringify(config, null, 2));

    await mongoose.disconnect();
  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

checkConfig();
