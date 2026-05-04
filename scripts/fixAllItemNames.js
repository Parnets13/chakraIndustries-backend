import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import dotenv from 'dotenv';

dotenv.config();

const fixAllItemNames = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Get all inventory items
    const items = await InventoryItem.find();
    console.log(`Found ${items.length} items to process\n`);

    let updated = 0;

    for (const item of items) {
      const oldName = item.name;
      
      // Generate proper name from SKU
      // Extract meaningful part from SKU
      let properName = item.sku;
      
      if (item.sku.includes('PO-')) {
        // For PO items, use a descriptive name
        properName = `Item ${item.sku}`;
      } else if (item.sku.includes('DSHG')) {
        properName = `Item ${item.sku}`;
      } else {
        properName = `Item ${item.sku}`;
      }
      
      // Update the item
      await InventoryItem.findByIdAndUpdate(
        item._id,
        { name: properName },
        { new: true }
      );
      
      console.log(`✓ Updated: "${oldName}" → "${properName}"`);
      updated++;
    }

    console.log(`\n✓ Update complete!`);
    console.log(`✓ Updated: ${updated} items`);

    await mongoose.connection.close();
    console.log('✓ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
};

fixAllItemNames();
