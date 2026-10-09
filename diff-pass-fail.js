// diff-pass-fail.js — READ ONLY. Diffs the generated XML of a PASSED invoice vs a
// FAILED one, line by line, to find the structural difference causing EXCEPTIONS.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';

const cfg = { companyName: 'SRI CHAKRA INDUSTRIES', state: 'Karnataka', gstin: '29ABWFS0002M1ZR' };

// strip values, keep structure (tag names only) to compare shape
const shape = xml => xml.split('\n').map(l => l.trim().replace(/>[^<]*</, '><')).filter(Boolean);

async function main() {
  await connectDB();
  const passNo = process.argv[2] || 'BIW2624';   // a known-created invoice
  const failNo = process.argv[3] || 'BIW2560';   // a failing invoice

  const pass = await Invoice.findOne({ invoiceNo: passNo }).lean();
  const fail = await Invoice.findOne({ invoiceNo: failNo }).lean();
  if (!pass) { console.log(`PASS invoice ${passNo} not found`); }
  if (!fail) { console.log(`FAIL invoice ${failNo} not found`); }
  if (!pass || !fail) { await mongoose.disconnect(); process.exit(0); }

  const px = serializeTallyVoucher(normalizeToTallyVoucher(pass, {}), cfg, 'Create', '');
  const fx = serializeTallyVoucher(normalizeToTallyVoucher(fail, {}), cfg, 'Create', '');

  const ps = shape(px), fs = shape(fx);
  console.log(`PASS ${passNo}: ${ps.length} lines   FAIL ${failNo}: ${fs.length} lines\n`);

  // tag multiset diff
  const count = arr => arr.reduce((m,l)=>{m[l]=(m[l]||0)+1;return m;},{});
  const pc = count(ps), fc = count(fs);
  const all = new Set([...Object.keys(pc), ...Object.keys(fc)]);
  console.log('Lines present in one but not the other (structure):');
  let any=false;
  for (const l of all) {
    if ((pc[l]||0) !== (fc[l]||0)) { console.log(`  pass:${pc[l]||0} fail:${fc[l]||0}  ${l}`); any=true; }
  }
  if (!any) console.log('  (identical structure — difference is in VALUES, not tags)');

  // Also show the raw inventory block of each for value comparison
  const invBlock = xml => (xml.match(/<ALLINVENTORYENTRIES\.LIST>[\s\S]*?<\/ALLINVENTORYENTRIES\.LIST>/)||[''])[0];
  console.log('\n──── PASS inventory block ────');
  console.log(invBlock(px).split('\n').map(l=>'  '+l.trim()).join('\n'));
  console.log('\n──── FAIL inventory block ────');
  console.log(invBlock(fx).split('\n').map(l=>'  '+l.trim()).join('\n'));

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
