import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import dotenv from 'dotenv';

dotenv.config();

const syncInventoryWithPO = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Get all inventory items
    const items = await InventoryItem.find();
    console.log(`Found ${items.length} inventory items\n`);

    let updated = 0;

    for (const item of items) {
      // Try to find matching PO item
      const sku = item.sku;
      
      // Extract PO ID from SKU (e.g., "PO-2026-002-1" -> "PO-2026-002")
      const poMatch = sku.match(/^(PO-\d+-\d+)/);
      
      if (poMatch) {
        const poId = poMatch[1];
        const itemIdx = parseInt(sku.split('-').pop()) - 1;
        
        // Find the PO
        const po = await PurchaseOrder.findOne({ poId });
        
        if (po && po.items && po.items[itemIdx]) {
          const poItemName = po.items[itemIdx].name;
          
          if (item.name !== poItemName) {
            const oldName = item.name;
            item.name = poItemName;
            await item.save();
            
            console.log(`✓ ${sku}: "${oldName}" → "${poItemName}"`);
            updated++;
          }
        }
      }
    }

    console.log(`\n✓ Sync complete!`);
    console.log(`✓ Updated: ${updated} items`);

    await mongoose.connection.close();
    console.log('✓ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
};

syncInventoryWithPO();
