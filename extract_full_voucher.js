
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function extractFullVoucher(voucherNumber) {
  const filePath = path.join(__dirname, 'tally-xml-response.xml');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    console.log(`Reading ${filePath}...`);

    const voucherStartTag = `<VOUCHER`;
    const voucherEndTag = `</VOUCHER>`;

    let currentPos = 0;
    let found = false;

    while (currentPos < content.length) {
      const startIdx = content.indexOf(voucherStartTag, currentPos);
      if (startIdx === -1) break;

      const endIdx = content.indexOf(voucherEndTag, startIdx) + voucherEndTag.length;
      const voucherContent = content.slice(startIdx, endIdx);

      if (voucherContent.includes(`<VOUCHERNUMBER>${voucherNumber}</VOUCHERNUMBER>`)) {
        console.log(`\n=== Found full ${voucherNumber} voucher ===`);
        
        // Check if it has the necessary sections
        const hasLedgerEntries = voucherContent.includes('ALLLEDGERENTRIES.LIST');
        const hasInventoryEntries = voucherContent.includes('INVENTORYENTRIES.LIST');
        
        console.log(`Has ALLLEDGERENTRIES.LIST: ${hasLedgerEntries}`);
        console.log(`Has INVENTORYENTRIES.LIST: ${hasInventoryEntries}`);
        console.log(`Length: ${voucherContent.length} characters`);

        const outputPath = path.join(__dirname, `${voucherNumber}_full.xml`);
        await fs.writeFile(outputPath, voucherContent, 'utf8');
        console.log(`Saved to ${outputPath}`);
        
        // Also save a complete envelope for import
        const envelope = `<?xml version="1.0"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Import</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES>
          <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
        <TALLYMESSAGE xmlns:UDF="TallyUDF">
${voucherContent}
        </TALLYMESSAGE>
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

        const envelopePath = path.join(__dirname, `${voucherNumber}_full_import.xml`);
        await fs.writeFile(envelopePath, envelope, 'utf8');
        console.log(`Saved import-ready envelope to ${envelopePath}`);

        found = true;
        break;
      }

      currentPos = endIdx;
    }

    if (!found) {
      console.log(`${voucherNumber} not found in tally-xml-response.xml`);
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

// Extract SCI0937
extractFullVoucher('SCI0937');
