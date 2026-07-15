/**
 * Test full ship-to normalization + XML output for BIW11
 */
import 'dotenv/config';
import connectDB from '../config/database.js';
import Invoice from '../models/Invoice.js';
import ItemMaster from '../models/ItemMaster.js';
import TallyConfig from '../models/TallyConfig.js';
import { normalizeToTallyVoucher } from '../services/normalizeToTallyVoucher.js';
import { serializeTallyVoucher } from '../services/tallyExportService.js';

await connectDB();

const inv = await Invoice.findOne({ invoiceNo: 'BIW11' }).lean();
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });

// Enrich items
const enrichedItems = await Promise.all((inv.items || []).map(async item => {
  const im = item.itemId ? await ItemMaster.findById(item.itemId).lean() : null;
  return { ...item, hsn: item.hsn || im?.hsn || '', tallySalesLedger: item.tallySalesLedger || im?.tallySalesLedger || '' };
}));

const tv = normalizeToTallyVoucher({ ...inv, items: enrichedItems }, { periodEnd: cfg.tallyPeriodEnd || null });

console.log('\n=== NORMALIZED SHIP-TO FIELDS ===');
console.log('shipToName    :', tv.shipToName);
console.log('shipToAddress :', tv.shipToAddress);
console.log('shipToCity    :', tv.shipToCity);
console.log('shipToState   :', tv.shipToState);
console.log('shipToPincode :', tv.shipToPincode);

const xml = serializeTallyVoucher(tv, cfg);

// Extract ship-to section from XML
const shipToSection = xml.match(/BASICBASEPARTYDETAILS[\s\S]*?\/CONSIGNEECITY>/)?.[0] || 
                      xml.match(/CONSIGNEENAME[\s\S]*?\/CONSIGNEEPINCODE>/)?.[0] ||
                      'not found';

console.log('\n=== SHIP-TO XML OUTPUT ===');
// Find all consignee/ship-to tags
const tags = ['BASICBASEPARTYDETAILS.LIST', 'CONSIGNEENAME', 'CONSIGNEEMAILINGNAME', 
               'CONSIGNEEGSTIN', 'CONSIGNEEPINCODE', 'CONSIGNEESTATENAME', 'CONSIGNEECITY'];
for (const tag of tags) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (match) console.log(`  <${tag}> ${match[1].substring(0, 80)}`);
}

// Also show BASICBUYERADDRESS inside BASICBASEPARTYDETAILS
const bbpd = xml.match(/<BASICBASEPARTYDETAILS\.LIST>([\s\S]*?)<\/BASICBASEPARTYDETAILS\.LIST>/i);
if (bbpd) {
  console.log('\n  BASICBASEPARTYDETAILS block:');
  console.log(' ', bbpd[0].replace(/\n\s*/g, ' ').substring(0, 300));
}

process.exit(0);
