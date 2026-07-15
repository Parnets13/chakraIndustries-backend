import 'dotenv/config';
import mongoose from 'mongoose';

const targetIds = ['PO-2026-008', 'PO-2026-007'];

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const collection = db.collection('purchaseorders');

  const docs = await collection.find({
    poId: { $nin: targetIds },
    tallySync: true,
    status: { $in: ['Approved', 'Received'] },
  }).sort({ createdAt: -1 }).limit(3).toArray();

  console.log('=== REFERENCE SUCCESSFUL PO DOCUMENTS ===');
  for (const doc of docs) {
    console.log(`\n=== PO ID: ${doc.poId || doc._id} ===`);
    console.log(JSON.stringify(doc, null, 2));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
