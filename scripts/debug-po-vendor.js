import 'dotenv/config';
import mongoose from 'mongoose';
import PurchaseOrder from '../models/PurchaseOrder.js';
import Vendor from '../models/Vendor.js';

await mongoose.connect(process.env.MONGO_URI);

const pos = await PurchaseOrder.find({
  status: { $in: ['Approved', 'Received'] },
  dataSource: { $ne: 'Tally' },
}).populate('vendor').lean();

console.log(`Found ${pos.length} ERP POs:\n`);
for (const po of pos) {
  console.log(`PO: ${po.poId}`);
  console.log(`  status   : ${po.status}`);
  console.log(`  vendor   : ${JSON.stringify(po.vendor)}`);
  console.log(`  vendorId : ${po.vendorId || po.vendor?._id || '(none)'}`);
  console.log(`  items    : ${(po.items||[]).map(i=>i.name).join(', ')}`);
  console.log('');
}

// Also show all vendors
const vendors = await Vendor.find({}).lean();
console.log(`All vendors in DB (${vendors.length}):`);
vendors.forEach(v => console.log(`  ${v._id} → ${v.companyName}`));

await mongoose.disconnect();
