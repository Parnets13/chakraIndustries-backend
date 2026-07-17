
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function modifyVoucher() {
  const inputPath = path.join(__dirname, 'SCI0937_full.xml');
  try {
    let voucherContent = await fs.readFile(inputPath, 'utf8');
    console.log(`Read ${inputPath}`);

    // 1. Change VOUCHERNUMBER from SCI0937 to SUBTRACT01
    voucherContent = voucherContent.replace(
      '<VOUCHERNUMBER>SCI0937</VOUCHERNUMBER>',
      '<VOUCHERNUMBER>SUBTRACT01</VOUCHERNUMBER>'
    );

    // 2. Remove internal attributes from VOUCHER tag: REMOTEID, VCHKEY, GUID, ALTERID, MASTERID, etc.
    // Remove attributes like REMOTEID="...", VCHKEY="...", GUID="..."
    voucherContent = voucherContent.replace(/\s+REMOTEID="[^"]*"/g, '');
    voucherContent = voucherContent.replace(/\s+VCHKEY="[^"]*"/g, '');
    voucherContent = voucherContent.replace(/\s+GUID="[^"]*"/g, '');
    voucherContent = voucherContent.replace(/\s+REMOTEALTGUID="[^"]*"/g, '');
    voucherContent = voucherContent.replace(/\s+REMOTEGUID="[^"]*"/g, '');

    // 3. Remove internal tags entirely: <ALTERID>, <MASTERID>, <VOUCHERKEY>, <VOUCHERRETAINKEY>, <REMOTEALTERID>, etc.
    const tagsToRemove = [
      'ALTERID',
      'MASTERID',
      'VOUCHERKEY',
      'VOUCHERRETAINKEY',
      'REMOTEALTERID',
      'GUID',
      'REMOTEGUID',
      'REMOTEALTGUID'
    ];
    
    tagsToRemove.forEach(tag => {
      const regex = new RegExp(`\\s*<${tag}[^>]*>[^<]*<\\/${tag}>`, 'g');
      voucherContent = voucherContent.replace(regex, '');
    });

    // 4. Also add ACTION="Create" to the VOUCHER tag if not present
    if (!voucherContent.includes('ACTION=')) {
      voucherContent = voucherContent.replace(
        '<VOUCHER',
        '<VOUCHER ACTION="Create"'
      );
    }

    // 5. Wrap it in proper ENVELOPE for import
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

    const outputPath = path.join(__dirname, 'SCI0937_subtract01_test.xml');
    await fs.writeFile(outputPath, envelope, 'utf8');
    console.log(`Saved modified voucher to ${outputPath}`);
  } catch (err) {
    console.error('Error:', err);
  }
}

modifyVoucher();
