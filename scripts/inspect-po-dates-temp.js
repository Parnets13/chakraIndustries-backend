import 'dotenv/config';
import mongoose from 'mongoose';

const targetIds = ['PO-2026-008', 'PO-2026-007'];

const isDateLikeField = (key, value) => {
  if (key === '_id' || key === '__v') return false;
  if (value instanceof Date) return true;
  if (typeof value === 'string') {
    const v = value.trim();
    return /\b(?:Date|date|at|time|created|updated|delivery|order|invoice|po)\b/i.test(key) && /\d{4}-\d{2}-\d{2}|\d{4}\/\d{2}\/\d{2}|\d{8}|T\d{2}:\d{2}:\d{2}/.test(v);
  }
  return false;
};

const inspectDocument = (doc) => {
  const dateLikeFields = {};
  for (const [key, value] of Object.entries(doc)) {
    if (isDateLikeField(key, value)) {
      dateLikeFields[key] = {
        value,
        type: value === null ? 'null' : Array.isArray(value) ? 'array' : value instanceof Date ? 'Date' : typeof value,
        isValidDate: value instanceof Date ? !Number.isNaN(value.getTime()) : false,
      };
    }
  }
  return { doc, dateLikeFields };
};

async function main() {
  await mongoose.connect(process.env.MONGO_URI);
  const db = mongoose.connection.db;
  const collection = db.collection('purchaseorders');

  const targetDocs = await collection.find({ poId: { $in: targetIds } }).toArray();
  const targetMap = new Map(targetDocs.map((doc) => [doc.poId, doc]));

  console.log('=== TARGET PO DOCUMENTS ===');
  for (const poId of targetIds) {
    const doc = targetMap.get(poId);
    if (!doc) {
      console.log(`\n=== ${poId} NOT FOUND ===\n`);
      continue;
    }
    const { dateLikeFields } = inspectDocument(doc);
    console.log(`\n=== PO ID: ${poId} ===`);
    console.log(JSON.stringify(doc, null, 2));
    console.log('\n=== DATE-LIKE FIELDS ===');
    console.log(JSON.stringify(dateLikeFields, null, 2));
  }

  const successDocs = await collection.find({
    status: { $in: ['Approved', 'Received'] },
    tallySync: true,
    poId: { $exists: true },
  }).sort({ createdAt: -1 }).limit(3).toArray();

  console.log('\n=== SUCCESSFUL EXPORT REFERENCE DOCUMENTS ===');
  for (const doc of successDocs) {
    const { dateLikeFields } = inspectDocument(doc);
    console.log(`\n=== PO ID: ${doc.poId || doc._id} ===`);
    console.log(JSON.stringify(doc, null, 2));
    console.log('\n=== DATE-LIKE FIELDS ===');
    console.log(JSON.stringify(dateLikeFields, null, 2));
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
