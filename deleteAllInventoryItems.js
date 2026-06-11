import dotenv from 'dotenv';
import connectDB from './config/database.js';
import InventoryItem from './models/InventoryItem.js';

dotenv.config();

const run = async () => {
  await connectDB();
  const result = await InventoryItem.deleteMany({});
  console.log('Deleted InventoryItem count:', result.deletedCount);
  process.exit(0);
};

run().catch(err => {
  console.error('Error deleting inventory items:', err);
  process.exit(1);
});
