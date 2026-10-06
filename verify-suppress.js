// verify-suppress.js — READ ONLY. Confirms GSTLEDGERSOURCE is no longer emitted
// for the previously-failing invoices, so they now behave like the 79 that passed.
import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';

const cfg = { companyName: 'SRI CHAKRA INDUSTRIES', state: 'Karnataka', gstin: '29ABWFS0002M1ZR' };

async function main() {
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 20000 });
  const invs = await Invoice.find({ status: { $nin: ['Cancelled'] } }).lean();

  let withSource = 0, hsnOk = 0, hsnMissing = [];
  for (const inv of invs) {
    const tv = normalizeToTallyVoucher(inv, {});
    const xml = serializeTallyVoucher(tv, cfg, 'Create', '');
    if (/<GSTLEDGERSOURCE>/.test(xml)) withSource++;
    // HSN should still be present via GSTHSNNAME
    if (/<GSTHSNNAME>/.test(xml)) hsnOk++; else hsnMissing.push(inv.invoiceNo);
  }

  console.log('═══════════════════════════════════════════════');
  console.log(`  Total invoices:                      ${invs.length}`);
  console.log(`  Still emitting <GSTLEDGERSOURCE>:    ${withSource}  (want 0)`);
  console.log(`  Still have <GSTHSNNAME> (HSN kept):  ${hsnOk}`);
  console.log('═══════════════════════════════════════════════');
  if (hsnMissing.length) console.log('HSN MISSING on: ' + hsnMissing.join(', '));
  if (withSource === 0) console.log('\n✓ GSTLEDGERSOURCE suppressed on ALL invoices — they now match the 79 that passed.');

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
