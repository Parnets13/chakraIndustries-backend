import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';
import Invoice from '../models/Invoice.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg   = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const TALLY = cfg.tallyLocalUrl || 'http://localhost:9000';
const CO    = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();

function esc(s) { return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : ''; }

// Check which BIW invoices already exist in Tally
const coTag = `<SVCURRENTCOMPANY>${esc(CO)}</SVCURRENTCOMPANY>`;
console.log('Checking Tally for existing BIW vouchers...');

const r = await axios.post(TALLY, `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BIWCheck</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE>
<COLLECTION NAME="BIWCheck"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,Date,VoucherTypeName</FETCH></COLLECTION>
</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`,
{ headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });

const body = String(r.data || '');
const vchNums = [...body.matchAll(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/gi)].map(m => m[1].trim());
const biwInTally = vchNums.filter(v => v.startsWith('BIW'));
console.log(`BIW vouchers in Tally (${biwInTally.length}):`, biwInTally.join(', '));

// Check DB
const dbInvoices = await Invoice.find({ invoiceNo: /^BIW/ }, { invoiceNo: 1, tallySync: 1, invoiceDate: 1 }).lean();
console.log(`\nBIW invoices in DB (${dbInvoices.length}):`);
dbInvoices.forEach(i => console.log(`  ${i.invoiceNo}  tallySync=${i.tallySync}  date=${i.invoiceDate}`));

// Find ones in DB but not in Tally
const tallySet = new Set(biwInTally);
const notInTally = dbInvoices.filter(i => !tallySet.has(i.invoiceNo));
console.log(`\nNOT in Tally yet (${notInTally.length}):`, notInTally.map(i => i.invoiceNo).join(', '));

// Find ones in Tally but tallySync=false in DB
const notMarkedSynced = dbInvoices.filter(i => tallySet.has(i.invoiceNo) && !i.tallySync);
console.log(`In Tally but NOT marked synced in DB (${notMarkedSynced.length}):`, notMarkedSynced.map(i => i.invoiceNo).join(', '));

await mongoose.disconnect();
