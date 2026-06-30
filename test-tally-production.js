
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { testConnection } from './services/tally-production-service.js';

dotenv.config();

// Connect to MongoDB first
async function init() {
  console.log('Connecting to MongoDB...');
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');
    
    console.log('\nTesting Tally connection with production service...');
    const result = await testConnection();
    console.log('\n✅ Tally connection test passed!');
    console.log('Response:', result.response);
  } catch (err) {
    console.error('\n❌ Error:', err);
  } finally {
    await mongoose.disconnect();
  }
}

init();
