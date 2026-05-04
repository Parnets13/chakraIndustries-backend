import mongoose from 'mongoose';
import dotenv from 'dotenv';
import connectDB from '../config/database.js';
import Inventory from '../models/Inventory.js';
import Warehouse from '../models/Warehouse.js';

dotenv.config();

const checkData = async () => {
  try {
    await connectDB();
    
    console.log('\n📊 Checking Inventory Data...');
    const totalCount = await Inventory.countDocuments();
    console.log(`Total inventory items: ${totalCount}`);
    
    const itemsWithDates = await Inventory.countDocuments({
      $or: [
        { lastMovementDate: { $exists: true, $ne: null } },
        { mfgDate: { $exists: true, $ne: null } },
        { createdDate: { $exists: true, $ne: null } }
      ]
    });
    console.log(`Items with dates: ${itemsWithDates}`);
    
    const itemsWithQty = await Inventory.countDocuments({ totalQuantity: { $gt: 0 } });
    console.log(`Items with quantity > 0: ${itemsWithQty}`);
    
    const sample = await Inventory.findOne({ totalQuantity: { $gt: 0 } })
      .populate('warehouse', 'warehouseId name');
    
    if (sample) {
      console.log('\n📦 Sample Item:');
      console.log(`  SKU: ${sample.sku}`);
      console.log(`  Name: ${sample.name}`);
      console.log(`  Qty: ${sample.totalQuantity}`);
      console.log(`  Unit Price: ${sample.unitPrice}`);
      console.log(`  Warehouse: ${sample.warehouse?.warehouseId}`);
      console.log(`  Last Movement: ${sample.lastMovementDate}`);
      console.log(`  Mfg Date: ${sample.mfgDate}`);
      console.log(`  Created: ${sample.createdDate}`);
    } else {
      console.log('\n⚠️  No inventory items found with quantity > 0');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
};

checkData();
