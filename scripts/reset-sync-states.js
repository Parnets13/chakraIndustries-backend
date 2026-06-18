
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import TallySyncState from '../models/TallySyncState.js';

dotenv.config();

async function reset() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    const result = await TallySyncState.deleteMany({});
    console.log(`✅ Deleted ${result.deletedCount} sync states!`);
    console.log('Now run a full sync from the UI!');
    process.exit(0);
  } catch (e) {
    console.error('Error:', e);
    process.exit(1);
  }
}

reset();
