import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import dotenv from 'dotenv';

dotenv.config();

const updateItemNames = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Get all inventory items
    const items = await InventoryItem.find();
    console.log(`Found ${items.length} items to update`);

    let updated = 0;
    let skipped = 0;

    for (const item of items) {
      // If name is empty, null, or just generic names, update it
      if (!item.name || item.name === '' || item.name === 'Unknown Item' || 
          item.name === 'nutshell' || item.name === 'Abc' || item.name === 'DEDFDC') {
        
        // Generate a proper name from SKU
        const properName = `Item-${item.sku}`;
        
        await InventoryItem.findByIdAndUpdate(
          item._id,
          { name: properName },
          { new: true }
        );
        
        console.log(`✓ Updated: ${item.sku} → ${properName}`);
        updated++;
      } else {
        console.log(`- Skipped: ${item.sku} (already has name: ${item.name})`);
        skipped++;
      }
    }

    console.log(`\nUpdate complete!`);
    console.log(`Updated: ${updated} items`);
    console.log(`Skipped: ${skipped} items`);

    await mongoose.connection.close();
    console.log('Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('Error updating item names:', error);
    process.exit(1);
  }
};

updateItemNames();
