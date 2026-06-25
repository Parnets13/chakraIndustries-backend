/**
 * Examine the exact XML structure of Collection response inventory entries
 * to understand what tags to parse
 */
import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const url = 'http://localhost:9000';
const company = 'SRI CHAKRA INDUSTRIES';

// Use the working query (Jun 16 only to keep response small)
const xml = `<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>AllVch</ID></HEADER><BODY><DESC><STATICVARIABLES><SVCURRENTCOMPANY>${company}</SVCURRENTCOMPANY><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>20260616</SVFROMDATE><SVTODATE>20260616</SVTODATE></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="AllVch"><TYPE>Voucher</TYPE><FETCH>GUID, VoucherNumber, Date, PartyLedgerName, Amount, VoucherTypeName, Narration, ALLLEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST</FETCH></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`;

const r = await axios.post(url, xml, { headers: { 'Content-Type': 'text/xml' }, timeout: 30000 });
const resp = r.data;
console.log(`Response: ${resp.length} chars`);
console.log(`Vouchers: ${(resp.match(/<VOUCHER[\s>]/gi)||[]).length}`);

// Find a Reward360 voucher and show its full block
const r360 = resp.indexOf('Reward360');
if (r360 !== -1) {
  const vStart = resp.lastIndexOf('<VOUCHER', r360);
  const vEnd = resp.indexOf('</VOUCHER>', r360) + 10;
  console.log('\n=== Full Reward360 voucher block ===');
  console.log(resp.slice(vStart, vEnd));
}

// Also show a voucher that HAS inventory (SCI01100 equivalent from June 18)
// First find a voucher with ALLINVENTORYENTRIES
const invIdx = resp.indexOf('<ALLINVENTORYENTRIES.LIST>');
if (invIdx !== -1) {
  const vStart = resp.lastIndexOf('<VOUCHER', invIdx);
  const vEnd = resp.indexOf('</VOUCHER>', invIdx) + 10;
  console.log('\n=== First voucher with ALLINVENTORYENTRIES.LIST ===');
  console.log(resp.slice(vStart, vEnd));
}

// Show all unique tag names inside ALLINVENTORYENTRIES.LIST
const invMatch = resp.match(/<ALLINVENTORYENTRIES\.LIST>([\s\S]*?)<\/ALLINVENTORYENTRIES\.LIST>/i);
if (invMatch) {
  const tags = [...invMatch[1].matchAll(/<([A-Z][A-Z0-9.]*)[^>]*>/g)].map(m=>m[1]);
  console.log('\n=== Tags inside ALLINVENTORYENTRIES.LIST ===');
  console.log([...new Set(tags)].join(', '));
}
