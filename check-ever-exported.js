// check-ever-exported.js — READ ONLY. Did any INVOICE using these items EVER
// get a voucher GUID (= actually created in Tally)?
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import StockInvoiceArchive from './models/StockInvoiceArchive.js';

const ITEMS = ['Livpure-Celestia-4 Burner-Auto Ignition','LIV-COOLMIST-48L','LIV-DRIFT-PLUS-60-FL-HAC-INCLINED','DRY IRON SLEEK DLX PRO','Electric Dry Iron Panache Plus 1100W','ELECTRIC KETTLE VIVA XPRESS 1.5L'];

function hasItem(doc) {
  const items = doc.items || doc.invoice?.items || [];
  return items.some(it => ITEMS.includes((it.description||it.name||'').trim()));
}

async function main() {
  await connectDB();
  const arch = await StockInvoiceArchive.find({}).lean();
  const archHits = arch.filter(hasItem);
  const synced = archHits.filter(a => (a.invoice?.tallyGuid || a.tallyGuid));
  console.log(`Archive records using these 6 items: ${archHits.length}`);
  console.log(`Of those, with a voucher GUID (actually created in Tally): ${synced.length}`);
  const seen = new Set();
  for (const a of archHits) {
    const inv = a.invoice || a;
    const no = inv.invoiceNo || '?';
    if (seen.has(no)) continue; seen.add(no);
    if (seen.size <= 25) console.log(`  ${no} | tallySync=${inv.tallySync} | voucherGuid=${inv.tallyGuid?'YES':'no'}`);
  }
  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
