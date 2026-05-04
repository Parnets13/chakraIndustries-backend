import mongoose from 'mongoose';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Vendor from '../models/Vendor.js';
import dotenv from 'dotenv';

dotenv.config();

const fixPOItemNames = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Get all purchase orders
    const pos = await PurchaseOrder.find().populate('vendor', 'companyName');
    console.log(`Found ${pos.length} purchase orders\n`);

    let updated = 0;

    for (const po of pos) {
      console.log(`Processing PO: ${po.poId}`);
      
      let poUpdated = false;
      
      // Update each item in the PO
      po.items = po.items.map((item, idx) => {
        const oldName = item.name;
        
        // Generate proper name
        let properName = item.name;
        
        // If name is generic or empty, generate a proper one
        if (!item.name || item.name === '' || item.name === 'nutshell' || 
            item.name === 'Abc' || item.name === 'DEDFDC' || item.name.includes('Item')) {
          
          // Use vendor name + item index
          const vendorName = po.vendor?.companyName || 'Unknown Vendor';
          properName = `${vendorName} - Item ${idx + 1}`;
          poUpdated = true;
        }
        
        if (oldName !== properName) {
          console.log(`  ✓ Item ${idx + 1}: "${oldName}" → "${properName}"`);
        }
        
        return {
          ...item,
          name: properName
        };
      });
      
      if (poUpdated) {
        await po.save();
        updated++;
        console.log(`  ✓ PO ${po.poId} updated\n`);
      } else {
        console.log(`  - PO ${po.poId} skipped (no changes needed)\n`);
      }
    }

    console.log(`\n✓ Update complete!`);
    console.log(`✓ Updated: ${updated} purchase orders`);

    await mongoose.connection.close();
    console.log('✓ Database connection closed');
    process.exit(0);
  } catch (error) {
    console.error('✗ Error:', error.message);
    process.exit(1);
  }
};

fixPOItemNames();
