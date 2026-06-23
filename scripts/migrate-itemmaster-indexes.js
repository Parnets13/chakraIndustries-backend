
import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chakra';

async function migrate() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected!');

  const db = mongoose.connection.db;
  const collection = db.collection('itemmasters');

  console.log('\nDropping old indexes...');
  const indexes = await collection.indexes();
  for (const index of indexes) {
    if (index.name !== '_id_') {
      console.log(`Dropping index: ${index.name}`);
      try {
        await collection.dropIndex(index.name);
      } catch (err) {
        console.log(`Warning: Could not drop index ${index.name}:`, err.message);
      }
    }
  }

  console.log('\nCreating new indexes...');
  await collection.createIndex({ tallyGuid: 1 }, { unique: true, sparse: true });
  console.log('Created index: tallyGuid (unique, sparse)');
  
  await collection.createIndex({ barcode: 1 }, { unique: true, sparse: true });
  console.log('Created index: barcode (unique, sparse)');

  console.log('\nMigration complete!');
  process.exit(0);
}

migrate().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});

