import 'dotenv/config';
import mongoose from 'mongoose';
import ItemMaster from '../models/ItemMaster.js';

const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
console.log('Connecting to MongoDB...');
await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000, connectTimeoutMS: 30000 });
console.log('Connected.\n');

// 1. Specific item
const specific = await ItemMaster.findOne(
  { $or: [{ name: /HYDRA STEEL WATER BOTTLE 1000ML/i }, { hsn: '73239990' }] },
  'name hsn gst tallySalesLedger dataSource isActive'
).lean();

console.log('=== SPECIFIC ITEM (HYDRA STEEL WATER BOTTLE 1000ML / HSN 73239990) ===');
if (specific) {
  console.log(`  name             : ${specific.name}`);
  console.log(`  hsn              : ${specific.hsn}`);
  console.log(`  gst              : ${specific.gst}`);
  console.log(`  tallySalesLedger : ${specific.tallySalesLedger}`);
  console.log(`  dataSource       : ${specific.dataSource}`);
  console.log(`  isActive         : ${specific.isActive}`);
} else {
  console.log('  NOT FOUND by name or HSN 73239990');
}

// 2. Collection-wide breakdown
const total       = await ItemMaster.countDocuments({});
const gstZero     = await ItemMaster.countDocuments({ gst: 0 });
const gstNull     = await ItemMaster.countDocuments({ gst: null });
const gstMissing  = await ItemMaster.countDocuments({ gst: { $exists: false } });
const gstPositive = await ItemMaster.countDocuments({ gst: { $gt: 0 } });

console.log('\n=== COLLECTION-WIDE GST BREAKDOWN ===');
console.log(`  Total items      : ${total}`);
console.log(`  gst > 0          : ${gstPositive}`);
console.log(`  gst = 0          : ${gstZero}`);
console.log(`  gst = null       : ${gstNull}`);
console.log(`  gst field missing: ${gstMissing}`);

// 3. Sample of items with gst = 0 or null
const zeroSample = await ItemMaster.find(
  { $or: [{ gst: 0 }, { gst: null }] },
  'name hsn gst dataSource isActive'
).limit(12).lean();

console.log('\n=== SAMPLE: items with gst = 0 or null (up to 12) ===');
if (zeroSample.length === 0) {
  console.log('  (none)');
} else {
  zeroSample.forEach(i =>
    console.log(`  "${i.name}" | hsn=${i.hsn||'—'} | gst=${i.gst} | src=${i.dataSource} | active=${i.isActive}`)
  );
}

// 4. Sample of items with gst > 0
const posSample = await ItemMaster.find(
  { gst: { $gt: 0 } },
  'name hsn gst dataSource isActive'
).limit(10).lean();

console.log('\n=== SAMPLE: items with gst > 0 (up to 10) ===');
if (posSample.length === 0) {
  console.log('  (none)');
} else {
  posSample.forEach(i =>
    console.log(`  "${i.name}" | hsn=${i.hsn||'—'} | gst=${i.gst} | src=${i.dataSource} | active=${i.isActive}`)
  );
}

await mongoose.disconnect();
