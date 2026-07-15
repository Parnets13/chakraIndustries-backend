#!/usr/bin/env node
import connectDB from './config/database.js';
import TallyConfig from './models/TallyConfig.js';
import Invoice from './models/Invoice.js';
import { normalizeToTallyVoucher } from './services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from './services/tallyExportService.js';

await connectDB();
const invoiceNo = process.env.INVOICE_NO || process.argv[2];
if (!invoiceNo) { console.error('Provide invoiceNo via INVOICE_NO env or CLI arg'); process.exit(1); }

const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
if (!cfg) { console.error('No TallyConfig found'); process.exit(1); }

const inv = await Invoice.findOne({ invoiceNo }).lean();
if (!inv) { console.error(`Invoice ${invoiceNo} not found`); process.exit(1); }

// Normalize (no gstLedgerNames, no periodEnd)
const tv = normalizeToTallyVoucher(inv, { gstLedgerNames: null, periodEnd: cfg?.tallyPeriodEnd || null, companyName: cfg?.companyName || '' });

console.log('---CFG.STATE---');
console.log(cfg.state || '(empty)');
console.log('---TV.PARTYSTATE---');
console.log(tv.partyState || '(empty)');
console.log('---SERIALIZED VOUCHER XML START---');
const xml = serializeTallyVoucher(tv, (cfg && cfg.toObject ? cfg.toObject() : cfg), 'Create', '');
console.log(xml);
console.log('---SERIALIZED VOUCHER XML END---');

process.exit(0);
