import 'dotenv/config';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

await connectDB();

const inv = await Invoice.findOne({ invoiceNo: 'BIW16' }).lean();
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();

console.log('=== RAW DB FIELDS ===');
console.log('shipToName    :', inv.shipToName);
console.log('shipToAddress :', inv.shipToAddress);
console.log('shipToCity    :', inv.shipToCity);
console.log('shipToState   :', inv.shipToState);
console.log('shipToPincode :', inv.shipToPincode);
console.log('billToName    :', inv.billToName);
console.log('billToAddress :', inv.billToAddress);
console.log('partyName     :', inv.partyName);
console.log('partyAddress  :', inv.partyAddress);
console.log();
console.log('=== TALLYVOCHER CACHED (if any) ===');
console.log('tv.shipToName    :', inv.tallyVoucher?.shipToName);
console.log('tv.shipToAddress :', inv.tallyVoucher?.shipToAddress);
console.log('tv.billToAddress :', inv.tallyVoucher?.billToAddress);

// Normalize fresh
const enrichedItems = await Promise.all((inv.items || []).map(async item => {
  const im = item.itemId ? await ItemMaster.findById(item.itemId).lean() : null;
  return { ...item, hsn: item.hsn || im?.hsn || '', tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '' };
}));

const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd: cfg.tallyPeriodEnd || null });

console.log('\n=== NORMALIZED TV FIELDS ===');
console.log('shipToName    :', tv.shipToName);
console.log('shipToAddress :', tv.shipToAddress);
console.log('shipToCity    :', tv.shipToCity);
console.log('shipToState   :', tv.shipToState);
console.log('shipToPincode :', tv.shipToPincode);
console.log('billToName    :', tv.billToName);
console.log('billToAddress :', tv.billToAddress);

// Generate XML and extract consignee section
const xml = serializeTallyVoucher(tv, cfg);

console.log('\n=== CONSIGNEE XML TAGS ===');
const tags = ['BASICBASEPARTYDETAILS.LIST', 'CONSIGNEENAME', 'CONSIGNEEMAILINGNAME',
              'CONSIGNEEPINCODE', 'CONSIGNEESTATENAME'];
for (const tag of tags) {
  const m = xml.match(new RegExp(`<${tag.replace('.', '\\.')}[^>]*>([\\s\\S]*?)<\\/${tag.replace('.', '\\.')}>`, 'i'));
  if (m) console.log(`  <${tag}>:`, m[1].substring(0, 100).replace(/\n\s+/g, ' ').trim());
}

// Show BASICBUYERADDRESS inside BASICBASEPARTYDETAILS
const bbpd = xml.match(/<BASICBASEPARTYDETAILS\.LIST>([\s\S]*?)<\/BASICBASEPARTYDETAILS\.LIST>/i);
if (bbpd) {
  const addrs = [...bbpd[1].matchAll(/<BASICBUYERADDRESS>([\s\S]*?)<\/BASICBUYERADDRESS>/gi)].map(m => m[1].trim());
  console.log('  BASICBASEPARTYDETAILS addresses:', addrs);
}

process.exit(0);
