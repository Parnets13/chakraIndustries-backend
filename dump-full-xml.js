// dump-full-xml.js — READ ONLY. Dumps the COMPLETE voucher XML for one invoice.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';

const cfg = { companyName: 'SRI CHAKRA INDUSTRIES', state: 'Karnataka', gstin: '29ABWFS0002M1ZR' };
const no = process.argv[2] || 'BIW2560';

async function main() {
  await connectDB();
  const inv = await Invoice.findOne({ invoiceNo: no }).lean();
  if (!inv) { console.log('not found'); process.exit(0); }
  const tv = normalizeToTallyVoucher(inv, {});
  const xml = serializeTallyVoucher(tv, cfg, 'Create', '');
  console.log(xml);
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
