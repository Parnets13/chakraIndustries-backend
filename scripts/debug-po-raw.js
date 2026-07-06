import 'dotenv/config';
import mongoose from 'mongoose';

await mongoose.connect(process.env.MONGO_URI);

// Read raw documents without using the model to see ALL stored fields
const db = mongoose.connection.db;
const pos = await db.collection('purchaseorders').find({
  status: { $in: ['Approved', 'Received'] }
}).toArray();

console.log('Raw PO documents:\n');
pos.forEach(po => {
  console.log(JSON.stringify(po, null, 2));
  console.log('---');
});

await mongoose.disconnect();
