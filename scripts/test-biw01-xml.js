/**
 * Generates the XML for BIW01 locally and checks CONSIGNEEPLACE
 */
import dotenv from 'dotenv'; dotenv.config();
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';

await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);

const inv = await Invoice.findOne({ invoiceNo: 'BIW01' }).lean();
const cfg = await TallyConfig.findOne().lean();

if (!inv) { console.log('BIW01 NOT FOUND'); process.exit(); }

console.log('=== BIW01 Invoice Data ===');
console.log('shipToName:', JSON.stringify(inv.shipToName));
console.log('shipToAddress:', JSON.stringify(inv.shipToAddress));
console.log('shipToState (DB):', JSON.stringify(inv.shipToState));
console.log('billToState:', JSON.stringify(inv.billToState));

// Re-normalize
const tv = normalizeToTallyVoucher(inv, { salesVoucherTypeName: 'Sales' });

console.log('\n=== TallyVoucher Result ===');
console.log('tv.shipToName:', JSON.stringify(tv.shipToName));
console.log('tv.shipToState:', JSON.stringify(tv.shipToState));
console.log('tv.shipToAddress:', JSON.stringify(tv.shipToAddress));

// Simulate _resolveShipToState from tallyExportService
const v = tv;
const shipToName = (v.shipToName || '').trim();
let st = (v.shipToState || '').trim();
console.log('\n=== resolveShipToState ===');
console.log('Step 1 - stored v.shipToState:', JSON.stringify(st));

if (!st) {
  const addr = (v.shipToAddress || '').trim();
  const pinMatch = addr.match(/(?<![0-9])(\d{6})(?![0-9])/);
  if (pinMatch) {
    console.log('Step 2 - pincode found:', pinMatch[1]);
    const pin = parseInt(pinMatch[1], 10);
    if (pin >= 201001 && pin <= 244999) st = 'Uttar Pradesh';
    else if (pin >= 245001 && pin <= 249999) st = 'Uttarakhand';
    else if (pin >= 250001 && pin <= 285999) st = 'Uttar Pradesh';
    console.log('Step 2 - derived state:', st);
  } else {
    console.log('Step 2 - no pincode in address:', JSON.stringify(addr));
  }
}

console.log('\nFINAL resolvedShipToState:', JSON.stringify(st));
console.log('CONSIGNEEPLACE will be:', JSON.stringify(st || '(BLANK)'));

await mongoose.disconnect();
