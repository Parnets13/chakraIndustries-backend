import mongoose from 'mongoose';
import InventoryItem from '../models/InventoryItem.js';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Vendor from '../models/Vendor.js';
import dotenv from 'dotenv';

dotenv.config();

const cleanItemNames = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Update PO items first
    const pos = await PurchaseOrder.find().populate('vendor', 'companyName');
    console.log(`Updating ${pos.length} purchase orders...\n`);

    for (const po of pos) {
      po.items = po.items.map((item) => {
        const vendorName = po.vendor?.companyName || 'Unknown Vendor';
        return {
          ...item,
          name: vendorName
        };
      });
      await po.save();
      console.log(`✓ ${po.poId}: Items updated to vendor name`);
    }

    // Update inventory items
    const items = await InventoryItem.find();
    console.log(`\nUpdating ${items.length} inventory items...\n`);

    let updated = 0;
    for (const item of items) {
      const sku = item.sku;
      const poMatch = sku.match(/^(PO-\d+-\d+)/);
      
      if (poMatch) {
        const poId = poMatch[1];
        const itemIdx = parseInt(sku.split('-').pop()) - 1;
        
        const po = await PurchaseOrder.findOne({ poId }).populate('vendor', 'companyName');
        
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

    console.log(`\n✓ Complete!`);
    console.log(`✓ Updated: ${updated} inventory items`);

    await mongoose.connection.close();
    console.log('✓ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
};

cleanItemNames();
