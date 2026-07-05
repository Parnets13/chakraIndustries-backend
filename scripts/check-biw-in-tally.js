import 'dotenv/config';
import mongoose from 'mongoose';
import axios from 'axios';
import TallyConfig from '../models/TallyConfig.js';

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
const url = cfg.tallyLocalUrl || 'http://localhost:9000';
const co  = (cfg.companyName || 'SRI CHAKRA INDUSTRIES').trim().toUpperCase();

const xml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>BIWList</ID></HEADER>
<BODY><DESC>
<STATICVARIABLES><SVCURRENTCOMPANY>${co}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
<TDL><TDLMESSAGE><COLLECTION NAME="BIWList"><TYPE>Voucher</TYPE><FETCH>VoucherNumber,VoucherTypeName,Date</FETCH></COLLECTION></TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

const r = await axios.post(url, xml, { headers:{'Content-Type':'text/xml'}, timeout:20000 });
const b = String(r.data||'');
const blocks = [...b.matchAll(/<VOUCHER[^>]*>([\s\S]*?)<\/VOUCHER>/gi)].map(m=>m[1]);
const biw = blocks
  .map(bl=>({
    vno:  (bl.match(/<VOUCHERNUMBER>(.*?)<\/VOUCHERNUMBER>/i)?.[1]||'').trim(),
    type: (bl.match(/<VOUCHERTYPENAME>(.*?)<\/VOUCHERTYPENAME>/i)?.[1]||'').trim(),
    date: (bl.match(/<DATE>(.*?)<\/DATE>/i)?.[1]||'').trim(),
  }))
  .filter(v => v.vno.startsWith('BIW'));

console.log(`BIW vouchers in Tally (${biw.length}):`);
biw.forEach(v => console.log(`  ${v.vno}  type=${v.type}  date=${v.date}`));

await mongoose.disconnect();
