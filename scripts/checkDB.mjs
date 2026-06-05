import mongoose from 'mongoose';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

console.log('Connecting to:', process.env.MONGO_URI?.slice(0, 50) + '...');

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
console.log('Connected OK');

const Vendor  = mongoose.model('Vendor',  new mongoose.Schema({}, { strict: false }), 'vendors');
const Client  = mongoose.model('Client',  new mongoose.Schema({}, { strict: false }), 'clients');
const Item    = mongoose.model('Item',    new mongoose.Schema({}, { strict: false }), 'itemmasters');
const Ledger  = mongoose.model('Ledger',  new mongoose.Schema({}, { strict: false }), 'accountsledgers');

const [vc, cc, ic, lc] = await Promise.all([
  Vendor.countDocuments(),
  Client.countDocuments(),
  Item.countDocuments(),
  Ledger.countDocuments(),
]);

console.log('\n=== MongoDB Record Counts ===');
console.log('Vendors       :', vc);
console.log('Clients       :', cc);
console.log('Items         :', ic);
console.log('Ledgers       :', lc);

if (vc > 0) {
  const v = await Vendor.findOne().lean();
  console.log('\nSample vendor fields:', Object.keys(v).join(', '));
  console.log('  companyName:', v.companyName);
  console.log('  phone      :', v.phone);
  console.log('  tallySynced:', v.tallySynced);
}

await mongoose.disconnect();
console.log('\nDone.');
process.exit(0);
