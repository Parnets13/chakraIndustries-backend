import 'dotenv/config.js';
import mongoose from 'mongoose';
import { importFromFiles } from '../services/tallyFileService.js';

async function testImport() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB!');
    
    console.log('Testing import from files...');
    const result = await importFromFiles();
    
    console.log('Import Result:', result);
    
  } catch (err) {
    console.error('Test failed:', err);
  } finally {
    await mongoose.connection.close();
  }
}

testImport();
