import mongoose from 'mongoose';
import Inventory from './models/Inventory.js';
import InventoryItem from './models/InventoryItem.js';
import Warehouse from './models/Warehouse.js';
import dotenv from 'dotenv';

dotenv.config();

async function migrateInventory() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/sriChakraBackend');
    console.log('Connected to MongoDB');

    const items = await InventoryItem.find();
    console.log(`Found ${items.length} legacy inventory items`);

    for (const item of items) {
      // Find warehouse ObjectId
      const wh = await Warehouse.findOne({ warehouseId: item.warehouse });
      if (!wh) {
        console.log(`Skipping ${item.sku} - warehouse ${item.warehouse} not found`);
        continue;
      }

      // Check if already exists in professional Inventory
      const existing = await Inventory.findOne({ sku: item.sku, warehouse: wh._id });
      
      if (existing) {
        console.log(`Updating ${item.sku} in Inventory`);
        existing.totalQuantity = item.qty;
        existing.minQuantity = item.minQty;
        existing.unit = item.unit;
        existing.category = item.category;
        existing.grnId = item.grnId;
        existing.poId = item.poId;
        existing.vendorId = item.vendorId;
        await existing.save();
      } else {
        console.log(`Creating ${item.sku} in Inventory`);
        await Inventory.create({
          sku: item.sku,
          name: item.name,
          warehouse: wh._id,
          totalQuantity: item.qty,
          minQuantity: item.minQty,
          unit: item.unit,
          category: item.category,
          grnId: item.grnId,
          poId: item.poId,
          vendorId: item.vendorId,
          status: item.qty === 0 ? 'Dead' : item.qty < item.minQty ? 'Critical' : 'Active'
        });
      }
    }

    console.log('Migration completed');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  }
}

migrateInventory();
