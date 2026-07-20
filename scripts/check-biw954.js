import 'dotenv/config';
import mongoose from 'mongoose';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

await mongoose.connect(process.env.MONGO_URI);

const inv = await Invoice.findOne({ invoiceNo: 'BIW954' }).lean();
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();

console.log('\n═══ INVOICE BIW954 RAW DATA ═══');
console.log('partyName    :', inv.partyName);
console.log('partyGST     :', inv.partyGST);
console.log('partyState   :', inv.partyState);
console.log('billToState  :', inv.billToState);
console.log('billToGST    :', inv.billToGST);
console.log('shipToState  :', inv.shipToState);
console.log('grandTotal   :', inv.grandTotal);
console.log('cgstTotal    :', inv.cgstTotal);
console.log('sgstTotal    :', inv.sgstTotal);
console.log('igstTotal    :', inv.igstTotal);
console.log('\nItems:');
for (const it of (inv.items||[])) {
  console.log(' -', it.description||it.name, '| qty:', it.qty, '| rate:', it.rate, '| taxRate:', it.taxRate, '| cgst:', it.cgst, '| sgst:', it.sgst, '| igst:', it.igst);
}

console.log('\n═══ TALLY CONFIG ═══');
console.log('companyName  :', cfg.companyName);
console.log('state        :', cfg.state);
console.log('gstin        :', cfg.gstin);

// Enrich and normalize
const itemNames = [...new Set((inv.items||[]).map(i=>(i.description||i.name||'').trim()))];
const masters = await ItemMaster.find({ name: { $in: itemNames } }, 'name hsn tallySalesLedger gst').lean();
const mm = new Map(masters.map(m=>[m.name,m]));
const enriched = (inv.items||[]).map(item => {
  const n=(item.description||item.name||'').trim(), im=mm.get(n);
  return { ...item,
    hsn: (item.hsn||'').trim()||(im?.hsn||'').trim(),
    tallySalesLedger: (item.tallySalesLedger||'').trim()||(im?.tallySalesLedger||'').trim(),
    taxRate: item.taxRate || im?.gst || 0,
  };
});

const tv = normalizeToTallyVoucher({ ...inv, items: enriched }, { salesVoucherTypeName: 'Sales' });

console.log('\n═══ NORMALIZED VOUCHER ═══');
console.log('partyLedgerName :', tv.partyLedgerName);
console.log('partyGST        :', tv.partyGST);
console.log('partyState      :', tv.partyState);
console.log('billToState     :', tv.billToState);
console.log('billToGST       :', tv.billToGST);
console.log('_grandTotal     :', tv._grandTotal);
console.log('_salesBase      :', tv._salesBase);
console.log('_totalCGST      :', tv._totalCGST);
console.log('_totalSGST      :', tv._totalSGST);
console.log('_totalIGST      :', tv._totalIGST);

// Check intra/interstate logic
const partyGSTIN = (tv.partyGST || tv.billToGST || '').trim();
const partyStateCode = partyGSTIN.substring(0, 2);
const companyStateCode = (cfg.gstin || '').substring(0, 2);
console.log('\n═══ GST INTRA/INTERSTATE CHECK ═══');
console.log('Party GSTIN      :', partyGSTIN, '→ state code:', partyStateCode);
console.log('Company GSTIN    :', cfg.gstin, '→ state code:', companyStateCode);
console.log('Same state?      :', partyStateCode === companyStateCode);
console.log('Should use       :', partyStateCode === companyStateCode ? 'CGST+SGST (intrastate)' : 'IGST (interstate)');
console.log('We sent CGST     :', tv._totalCGST, '  SGST:', tv._totalSGST, '  IGST:', tv._totalIGST);
const isCorrect = partyStateCode === companyStateCode
  ? (tv._totalCGST > 0 && tv._totalSGST > 0 && tv._totalIGST === 0)
  : (tv._totalIGST > 0 && tv._totalCGST === 0);
console.log('Tax split correct?:', isCorrect ? '✅ YES' : '❌ NO — WRONG TAX TYPE!');

// Show relevant XML section
const xml = serializeTallyVoucher(tv, cfg, 'Create', '');
const placeMatch = xml.match(/<PLACEOFSUPPLY>(.*?)<\/PLACEOFSUPPLY>/);
const stateMatch = xml.match(/<STATENAME>(.*?)<\/STATENAME>/);
const cmpGstinMatch = xml.match(/<CMPGSTIN>(.*?)<\/CMPGSTIN>/);
const partyGstinMatch = xml.match(/<PARTYGSTIN>(.*?)<\/PARTYGSTIN>/);
console.log('\n═══ KEY XML FIELDS ═══');
console.log('PLACEOFSUPPLY :', placeMatch?.[1] || '(EMPTY!)');
console.log('STATENAME     :', stateMatch?.[1] || '(EMPTY!)');
console.log('CMPGSTIN      :', cmpGstinMatch?.[1] || '(EMPTY!)');
console.log('PARTYGSTIN    :', partyGstinMatch?.[1] || '(EMPTY!)');

await mongoose.disconnect();
