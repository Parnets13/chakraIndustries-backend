import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const dropOldIndex = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const db = mongoose.connection.db;
    const collection = db.collection('dockettrackings');

    // Drop the old lrNumber_1 index
    try {
      await collection.dropIndex('lrNumber_1');
      console.log('✅ Successfully dropped lrNumber_1 index');
    } catch (err) {
      if (err.code === 27) {
        console.log('⚠️  Index lrNumber_1 does not exist (already dropped)');
      } else {
        throw err;
      }
    }

    // List all indexes to verify
    const indexes = await collection.indexes();
    console.log('\nCurrent indexes:');
    indexes.forEach(idx => {
      console.log(`  - ${idx.name}: ${JSON.stringify(idx.key)}`);
    });

    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
};

dropOldIndex();
