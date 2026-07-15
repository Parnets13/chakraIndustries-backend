import fs from 'fs';
import path from 'path';

const TALLY_URL = 'http://localhost:9000';
const company = 'SRI CHAKRA INDUSTRIES';
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const makeRequest = async (xml) => {
  const res = await fetch(TALLY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml' },
    body: xml,
    timeout: 30000,
  });
  return res.text();
};

const buildCollection = (type, fetches, where='') => `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
<HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>${type}</ID></HEADER>
<BODY><DESC>
  <STATICVARIABLES><SVCURRENTCOMPANY>${esc(company)}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES>
  <TDL><TDLMESSAGE>
    <COLLECTION NAME="${type}"><TYPE>${type}</TYPE>${fetches.map(f => `<FETCH>${f}</FETCH>`).join('')}</COLLECTION>
  </TDLMESSAGE></TDL>
</DESC></BODY>
</ENVELOPE>`;

const query = async () => {
  console.log('Querying VoucherType...');
  const vtXml = buildCollection('VoucherType', ['Name']);
  const vtResp = await makeRequest(vtXml);
  const vtNames = [...vtResp.matchAll(/<NAME>(.*?)<\/NAME>/gi)].map(m => m[1].trim());
  console.log('VoucherType names:', vtNames.join(', '));

  console.log('\nQuerying Ledger names for Sales and Duties & Taxes...');
  const ledgerXml = buildCollection('Ledger', ['Name', 'Parent']);
  const ledgerResp = await makeRequest(ledgerXml);
  const ledgerLines = ledgerResp
    .split(/<LEDGER |<NAME>|<PARENT>/gi)
    .filter(Boolean)
    .slice(0, 40);
  console.log('Ledger snippet:');
  console.log(ledgerResp.split('\n').filter(l => /<NAME>|<PARENT>/.test(l)).slice(0, 50).join('\n'));

  console.log('\nQuerying stock items for HYDRA STEEL WATER BOTTLE 1000ML...');
  const stockXml = buildCollection('StockItem', ['Name']);
  const stockResp = await makeRequest(stockXml);
  console.log('Stock query size:', stockResp.length);
};

query().catch(e => { console.error('ERROR', e); process.exit(1); });
