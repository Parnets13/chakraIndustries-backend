import mongoose from 'mongoose';
import TallyConfig from '../models/TallyConfig.js';
import { postXmlWithRetry } from '../services/tallyFetchEngine.js';
import dotenv from 'dotenv';
dotenv.config();

await mongoose.connect(process.env.MONGO_URI);
const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
console.log('Config:', JSON.stringify({ company: cfg.companyName, url: cfg.tallyLocalUrl, connector: cfg.useConnector, connectorId: cfg.connectorId }, null, 2));

const pingXml = `<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>OpenCo</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="OpenCo" ISMODIFY="No"><TYPE>Company</TYPE><FETCH>Name</FETCH></COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY></ENVELOPE>`;

const resp = await postXmlWithRetry(cfg, pingXml, 30000);
console.log('Tally open company:', resp.slice(0, 800));
await mongoose.disconnect();
