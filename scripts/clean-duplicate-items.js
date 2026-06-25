import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import ItemMaster from '../models/ItemMaster.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../.env') });

const MONGODB_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/chakra';

async function cleanDuplicates() {
  console.log('Connecting to MongoDB...');
  await mongoose.connect(MONGODB_URI);
  console.log('Connected!');

  try {
    console.log('\nStep 1: Finding all items with tallyGuid...');
    const allItems = await ItemMaster.find({ tallyGuid: { $ne: null } }).sort({ updatedAt: -1 });
    console.log(`Found ${allItems.length} items with tallyGuid`);

    const guidMap = new Map();
    allItems.forEach(item => {
      const key = item.tallyGuid;
      if (!guidMap.has(key)) {
        guidMap.set(key, []);
      }
      guidMap.get(key).push(item);
    });

    console.log('\nStep 2: Processing duplicates...');
    let totalDeleted = 0;

    for (const [guid, items] of guidMap.entries()) {
      if (items.length > 1) {
        console.log(`Found ${items.length} duplicates for guid ${guid}`);
        // Keep the first (most recent) item, delete the rest
        const toDelete = items.slice(1);
        for (const item of toDelete) {
          await ItemMaster.deleteOne({ _id: item._id });
          console.log(`  Deleted item: ${item._id} (${item.name})`);
          totalDeleted++;
        }
      }
    }

    console.log(`\nStep 3: Updating ${allItems.length - totalDeleted} items to use correct itemId/sku...`);
    let updated = 0;
    let failed = 0;

    const remainingItems = await ItemMaster.find({ tallyGuid: { $ne: null } });
    for (const item of remainingItems) {
      const cleanGuid = item.tallyGuid.replace(/[^A-Z0-9]/gi, '');
      const correctItemId = `TALLY-${cleanGuid}`;
      const correctSku = correctItemId;

      if (item.itemId !== correctItemId || item.sku !== correctSku) {
        try {
          // First check if there's already an item with the correct itemId/sku
          const existing = await ItemMaster.findOne({
            $or: [{ itemId: correctItemId }, { sku: correctSku }],
            _id: { $ne: item._id }
          });

          if (existing) {
            console.log(`Conflict: Found existing item ${existing._id} with itemId=${correctItemId}. Deleting current item ${item._id}`);
            await ItemMaster.deleteOne({ _id: item._id });
            totalDeleted++;
          } else {
            await ItemMaster.updateOne(
              { _id: item._id },
              { $set: { itemId: correctItemId, sku: correctSku } }
            );
            console.log(`Updated item ${item._id}: itemId=${correctItemId}, sku=${correctSku}`);
            updated++;
          }
        } catch (e) {
          if (e.code === 11000) {
            console.error(`Duplicate key error updating ${item._id}, deleting it.`);
            await ItemMaster.deleteOne({ _id: item._id });
            totalDeleted++;
          } else {
            console.error(`Error updating ${item._id}:`, e.message);
            failed++;
          }
        }
      }
    }

    console.log('\nCleanup complete!');
    console.log(`  - Updated: ${updated}`);
    console.log(`  - Deleted: ${totalDeleted}`);
    console.log(`  - Failed: ${failed}`);

  } catch (e) {
    console.error('Error cleaning duplicates:', e);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

cleanDuplicates();
