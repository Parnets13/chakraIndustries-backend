
import TallyConfig from './models/TallyConfig.js';
import { postXmlWithRetry } from './services/tallyFetchEngine.js';
import esc from './services/tallyExportService.js'; // Wait, no, let's just copy the function.

async function testFetch() {
  try {
    const cfg = await TallyConfig.findOne();
    console.log('Using config:', cfg);

    const company = (cfg.companyName || '').trim().toUpperCase();
    const coTag = company ? `<SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY>` : '';

    const xml = `<ENVELOPE>
<HEADER>
  <VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST>
  <TYPE>Collection</TYPE><ID>SalesLedgers</ID>
</HEADER>
<BODY><DESC>
  <STATICVARIABLES>${coTag}<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="SalesLedgers">
      <TYPE>Ledger</TYPE>
      <FETCH>Name, Parent, TaxType, GSTRate, GSTApplicable</FETCH>
    </COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

    console.log('Request XML:', xml);
    const resp = await postXmlWithRetry(cfg, xml, 30000, 1);
    console.log('Response XML:', resp);
  } catch (err) {
    console.error('Error:', err);
  }
}

testFetch();
