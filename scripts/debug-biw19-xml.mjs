import 'dotenv/config';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

await connectDB();

const inv = await Invoice.findOne({ invoiceNo: 'BIW19' }).lean();
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } }).lean();

const enrichedItems = await Promise.all((inv.items || []).map(async item => {
  const im = item.itemId ? await ItemMaster.findById(item.itemId).lean() : null;
  return { ...item, hsn: item.hsn || im?.hsn || '', tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '' };
}));

const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd: cfg.tallyPeriodEnd || null });
const xml = serializeTallyVoucher(tv, cfg);

console.log('=== BIW19 Party Details XML ===\n');

// Extract Party Details section
const tags = [
  'BASICBUYERNAME', 'PARTYMAILINGNAME',
  'BASICBASEPARTYDETAILS.LIST',
  'CONSIGNEENAME', 'CONSIGNEEMAILINGNAME',
  'CONSIGNEEPINCODE', 'CONSIGNEESTATENAME'
];

for (const tag of tags) {
  const escaped = tag.replace('.', '\\.');
  const m = xml.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  if (m) {
    const val = m[1].replace(/\s+/g, ' ').trim().substring(0, 120);
    console.log(`<${tag}>: ${val}`);
  } else {
    console.log(`<${tag}>: NOT FOUND`);
  }
}

// Show BASICBUYERADDRESS lines from BASICBASEPARTYDETAILS (consignee block)
const bbpd = xml.match(/<BASICBASEPARTYDETAILS\.LIST>([\s\S]*?)<\/BASICBASEPARTYDETAILS\.LIST>/i);
if (bbpd) {
  const addrs = [...bbpd[1].matchAll(/<BASICBUYERADDRESS>([\s\S]*?)<\/BASICBUYERADDRESS>/gi)].map(m => m[1].trim());
  console.log('\nConsignee address lines:', addrs);
}

// Show BASICBUYERADDRESS from voucher level (bill-to block)
const buyerAddrMatch = xml.match(/BASICBUYERADDRESS\.LIST TYPE="String">([\s\S]*?)<\/BASICBUYERADDRESS\.LIST>/i);
if (buyerAddrMatch) {
  const addrs = [...buyerAddrMatch[1].matchAll(/<BASICBUYERADDRESS>([\s\S]*?)<\/BASICBUYERADDRESS>/gi)].map(m => m[1].trim());
  console.log('Bill-to address lines:', addrs);
}

process.exit(0);
