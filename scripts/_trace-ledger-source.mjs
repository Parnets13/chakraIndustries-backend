/**
 * READ-ONLY. For the mismatched items, compares the ledger stored on the INVOICE
 * vs the ledger stored in ITEMMASTER — to reveal WHERE the wrong ledger came from.
 * Changes nothing.
 */
import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';

await mongoose.connect(process.env.MONGO_URI || process.env.MONGODB_URI);
console.log('DB:', mongoose.connection.name, '\n');

const CHECK = [
  'Electric Maveric Storage Water Heater 15Ltr',
  'Electric Maveric Storage Water Heater 25Ltr',
  'Electric Dry Iron Panache Crystal 1100W',
  'ARTIC AIR 36\'\' CEILING FAN BROWN',
  'Electric Mixer Grinder With Food Processor Kitchen Genie 750 W',
  'Livpure Travel Neck Pillow 11x11x3',
  'Electric Fan Heater Glint 2000W',
];

for (const name of CHECK) {
  const im = await ItemMaster.findOne({ name }, 'name tallySalesLedger dataSource').lean();
  // find one invoice item with this name
  const inv = await Invoice.findOne({ 'items.description': name }, 'invoiceNo items').lean();
  const it = inv?.items?.find(i => (i.description || i.name) === name);
  console.log(`ITEM: ${name}`);
  console.log(`   ItemMaster.tallySalesLedger : "${im?.tallySalesLedger ?? '(no ItemMaster)'}"  [source: ${im?.dataSource || '-'}]`);
  console.log(`   Invoice item ledger         : "${it?.tallySalesLedger ?? '(not found)'}"  (e.g. ${inv?.invoiceNo || '-'})`);
  console.log('');
}

await mongoose.disconnect();
process.exit(0);
