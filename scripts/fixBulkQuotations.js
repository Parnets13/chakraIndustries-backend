import mongoose from 'mongoose';
import dotenv from 'dotenv';
import BulkQuotation from '../models/BulkQuotation.js';

dotenv.config();

const fixBulkQuotations = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Drop the old unique index
    try {
      await BulkQuotation.collection.dropIndex('quotationId_1');
      console.log('✓ Dropped old unique index');
    } catch (err) {
      console.log('Index does not exist or already dropped');
    }

    // Delete all documents with null quotationId
    const result = await BulkQuotation.deleteMany({ quotationId: null });
    console.log(`✓ Deleted ${result.deletedCount} documents with null quotationId`);

    // Recreate the index with sparse option
    await BulkQuotation.collection.createIndex({ quotationId: 1 }, { unique: true, sparse: true });
    console.log('✓ Created new sparse unique index');

    console.log('✓ BulkQuotation collection fixed successfully');

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error fixing bulk quotations:', error);
    process.exit(1);
  }
};

fixBulkQuotations();
