// dump-automasters.js — READ ONLY. Replicates the auto-masters STOCKITEM XML
// that exportSalesInvoices builds for the 9 failing items, so we can inspect it.
import dotenv from 'dotenv';
dotenv.config();
import connectDB from './config/database.js';
import mongoose from 'mongoose';
import Invoice from './models/Invoice.js';
import ItemMaster from './models/ItemMaster.js';

const esc = s => s==null?'':String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const FAILED = ['BIW2560','BIW2565','BIW2567','BIW2568','BIW2569','BIW2570','BIW2571','BIW2629','BIW2630'];

async function main() {
  await connectDB();
  const invs = await Invoice.find({ invoiceNo: { $in: FAILED } }).lean();

  // stockNames
  const stockNames = [...new Set(invs.flatMap(i=>(i.items||[]).map(it=>(it.description||it.name||'').trim())).filter(Boolean))];
  // stockGstRateMap
  const stockGstRateMap = new Map();
  for (const inv of invs) for (const item of (inv.items||[])) {
    const name=(item.description||item.name||'').trim();
    if(!name||stockGstRateMap.has(name))continue;
    let rate=+(item.taxRate||0);
    if(!rate){const tax=(+(item.cgst||0))+(+(item.sgst||0))+(+(item.igst||0));const base=+(item.basic||0)||(+(item.qty||1)*+(item.rate||0));if(tax>0&&base>0)rate=Math.round((tax/base)*100*2)/2;}
    if(rate>0)stockGstRateMap.set(name,rate);
  }
  const masters = await ItemMaster.find({ name: { $in: stockNames } }, 'name gst hsn').lean();
  const stockHsnMap = new Map(masters.map(m=>[m.name, m.hsn||'']));
  // simulate: no fetch (connector) → tallyStockGstMap empty → rateFetchUnavailable true
  const tallyStockGstMap = new Map();

  const stockUnitMap = new Map(stockNames.map(n=>[n,'Nos']));

  const autoStockXml = stockNames.map(name => {
    const gstRate = stockGstRateMap.get(name) || 0;
    const hsn = stockHsnMap.get(name) || '';
    const gstRateTag = gstRate>0?`<GSTRATE>${gstRate}</GSTRATE>`:'';
    const hsnTag = hsn?`<HSNCODE>${esc(hsn)}</HSNCODE>`:'';
    const gstDetailsTag = gstRate>0?`<GSTDETAILS.LIST ACTION="Replace"><APPLICABLEFROM>20230401</APPLICABLEFROM><TAXABILITY>Taxable</TAXABILITY><GSTRATEINPERCENT>${gstRate}</GSTRATEINPERCENT><ISREVERSECHARGE>No</ISREVERSECHARGE><ISINELIGIBLEITC>No</ISINELIGIBLEITC><GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY></GSTDETAILS.LIST>`:'';
    const tallyCurrentRate = tallyStockGstMap.get(name.toLowerCase());
    const existsInTally = tallyCurrentRate !== undefined;
    const tallyRateIsMissing = existsInTally && tallyCurrentRate === 0;
    const rateFetchUnavailable = tallyStockGstMap.size === 0;
    const unit = stockUnitMap.get(name) || 'Nos';
    if (!existsInTally && !rateFetchUnavailable) {
      return `<STOCKITEM NAME="${esc(name)}" ACTION="Create">...Create only...</STOCKITEM>`;
    } else if (tallyRateIsMissing && gstRate > 0) {
      return `<STOCKITEM NAME="${esc(name)}" ACTION="Alter">...Alter...</STOCKITEM>`;
    } else if (rateFetchUnavailable && gstRate > 0) {
      return `<STOCKITEM NAME="${esc(name)}" ACTION="Create"><UNITS>${esc(unit)}</UNITS>${hsnTag}${gstRateTag}${gstDetailsTag}</STOCKITEM>`
           + `\n<STOCKITEM NAME="${esc(name)}" ACTION="Alter">${hsnTag}${gstRateTag}${gstDetailsTag}</STOCKITEM>`;
    } else {
      return '(skip)';
    }
  }).join('\n');

  console.log('rateFetchUnavailable path is active (connector mode fetch empty):\n');
  console.log(autoStockXml);

  await mongoose.disconnect();
  process.exit(0);
}
main().catch(e=>{console.error(e.message);process.exit(1);});
