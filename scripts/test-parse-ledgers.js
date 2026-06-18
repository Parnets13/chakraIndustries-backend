
import axios from 'axios';

const TALLY_URL = 'http://localhost:9000';

// Copy of decodeXmlEntities from tallyFetchEngine.js
function decodeXmlEntities(s) {
  if (!s) return '';
  return String(s)
    .replace(/&amp;quot;/gi, '"')
    .replace(/&amp;apos;/gi, "'")
    .replace(/&amp;lt;/gi, '<')
    .replace(/&amp;gt;/gi, '>')
    .replace(/&amp;amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

// Copy of parseLedgers from tallyFetchEngine.js
function parseLedgers(xml) {
  const ledgers = [];
  for (const m of xml.matchAll(/<LEDGER([^>]*)>([\s\S]*?)<\/LEDGER>/gi)) {
    const attrs = m[1];
    const block = m[2] || '';

    // Extract name from various places
    let name = '';
    const nameAttrMatch = attrs.match(/NAME="([^"]*)"/i);
    if (nameAttrMatch) name = decodeXmlEntities(nameAttrMatch[1].trim());

    if (!name) {
      // Try LANGUAGENAME.LIST -> NAME.LIST -> NAME
      const langNameMatch = block.match(/<LANGUAGENAME\.LIST>[\s\S]*?<NAME\.LIST[\s\S]*?<NAME>([\s\S]*?)<\/NAME>/i);
      if (langNameMatch) name = decodeXmlEntities(langNameMatch[1].trim());
    }
    if (!name) {
      // Try LEDGSTNAME
      const gstNameMatch = block.match(/<LEDGSTNAME>([\s\S]*?)<\/LEDGSTNAME>/i);
      if (gstNameMatch) name = decodeXmlEntities(gstNameMatch[1].trim());
    }
    if (!name) {
      // Try MAILINGNAME
      const mailingNameMatch = block.match(/<MAILINGNAME>([\s\S]*?)<\/MAILINGNAME>/i);
      if (mailingNameMatch) name = decodeXmlEntities(mailingNameMatch[1].trim());
    }

    if (!name) continue;

    const parent = decodeXmlEntities((block.match(/<PARENT>([\s\S]*?)<\/PARENT>/i)?.[1] || '').trim());
    if (!parent.toLowerCase().includes('sundry')) continue;
    
    const guid = block.match(/<GUID>([\s\S]*?)<\/GUID>/i)?.[1]?.trim() || null;
    const alterId = block.match(/<ALTERID[^>]*>([\s\S]*?)<\/ALTERID>/i)?.[1]?.trim() || null;
    const gstNumber = decodeXmlEntities((block.match(/<PARTYGSTIN>([\s\S]*?)<\/PARTYGSTIN>/i)?.[1] || 'N/A').trim());
    const openingBalance = parseFloat(block.match(/<OPENINGBALANCE>([\s\S]*?)<\/OPENINGBALANCE>/i)?.[1]) || 0;
    const email = decodeXmlEntities((block.match(/<EMAIL>([\s\S]*?)<\/EMAIL>/i)?.[1] || '').trim());
    const phone = decodeXmlEntities((block.match(/<LEDGERMOBILE>([\s\S]*?)<\/LEDGERMOBILE>/i)?.[1] || '').trim());
    const contactPerson = decodeXmlEntities((block.match(/<MAILINGNAME>([\s\S]*?)<\/MAILINGNAME>/i)?.[1] || '').trim());
    const isCreditor = parent.toLowerCase().includes('creditor');

    ledgers.push({ 
      name, 
      guid, 
      alterId, 
      parent,
      gstNumber, 
      openingBalance, 
      email, 
      phone, 
      contactPerson, 
      isCreditor 
    });
  }
  return ledgers;
}

async function main() {
  const xml = `
<ENVELOPE>
  <HEADER><TALLYREQUEST>Export Data</TALLYREQUEST></HEADER>
  <BODY><EXPORTDATA>
    <REQUESTDESC>
      <REPORTNAME>List of Accounts</REPORTNAME>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      </STATICVARIABLES>
    </REQUESTDESC>
  </EXPORTDATA></BODY>
</ENVELOPE>
  `.trim();

  console.log('Fetching List of Accounts from Tally...');
  const res = await axios.post(TALLY_URL, xml, {
    headers: { 'Content-Type': 'text/xml' },
    timeout: 120000
  });

  console.log(`Got ${res.data.length} bytes`);
  
  const ledgers = parseLedgers(res.data);
  
  console.log(`\nParsed ${ledgers.length} ledgers (sundry debtors/creditors):`);
  console.log('First 10 ledgers:');
  console.log(ledgers.slice(0, 10).map(l => `${l.name} (${l.parent})`).join('\n'));
}

main().catch(console.error);
