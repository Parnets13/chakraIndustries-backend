/**
 * Examine inventory entry tag structure in Collection response
 * Use a tight date window (SCI01100 date = 18 Jun) to get a small response
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const url = 'http://localhost:9000';
const company = 'SRI CHAKRA INDUSTRIES';

// June 18 only — should return 3 vouchers (SCI01100, 01, 02) with items
const xmlJun18 = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllVch</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>20260618</SVFROMDATE><SVTODATE>20260618</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="AllVch"><TYPE>Voucher</TYPE><FETCH>GUID, VoucherNumber, Date, PartyLedgerName, Amount, VoucherTypeName, Narration, ALLLEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

try {
  const r = await axios.post(url, xmlJun18, { headers: { 'Content-Type': 'text/xml' }, timeout: 60000 });
  const xml = r.data;
  console.log(`Response: ${xml.length} chars`);
  
  const vNums = [...xml.matchAll(/<VOUCHERNUMBER>([^<]+)<\/VOUCHERNUMBER>/gi)].map(m=>m[1]);
  console.log(`Vouchers: ${vNums.join(', ')}`);
  
  const invCount = (xml.match(/<ALLINVENTORYENTRIES\.LIST>/gi)||[]).length;
  console.log(`ALLINVENTORYENTRIES.LIST count: ${invCount}`);
  
  // Show first ALLINVENTORYENTRIES.LIST block fully
  const invStart = xml.indexOf('<ALLINVENTORYENTRIES.LIST>');
  const invEnd = xml.indexOf('</ALLINVENTORYENTRIES.LIST>') + 27;
  if (invStart !== -1) {
    console.log('\n=== First ALLINVENTORYENTRIES.LIST block ===');
    console.log(xml.slice(invStart, invEnd));
  }
  
  // Show all tag names found inside any ALLINVENTORYENTRIES.LIST
  const allTags = new Set();
  for (const m of xml.matchAll(/<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>/gi)) {
    for (const t of m[1].matchAll(/<([A-Z][A-Z0-9._]*)[\s>]/g)) allTags.add(t[1]);
  }
  console.log('\n=== All tags inside ALLINVENTORYENTRIES.LIST ===');
  console.log([...allTags].join(', '));
  
  // Show first ALLLEDGERENTRIES.LIST block
  const ledStart = xml.indexOf('<ALLLEDGERENTRIES.LIST>');
  const ledEnd = xml.indexOf('</ALLLEDGERENTRIES.LIST>') + 24;
  if (ledStart !== -1) {
    console.log('\n=== First ALLLEDGERENTRIES.LIST block ===');
    console.log(xml.slice(ledStart, Math.min(ledEnd, ledStart + 800)));
  }
} catch(e) { console.error('Failed:', e.message); }
