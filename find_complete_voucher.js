
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function findCompleteVoucher() {
  const filePath = path.join(__dirname, 'tally-xml-response.xml');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    console.log('Searching for vouchers with ALLLEDGERENTRIES.LIST...');

    const voucherStartTag = `<VOUCHER`;
    const voucherEndTag = `</VOUCHER>`;

    let currentPos = 0;
    let count = 0;

    while (currentPos < content.length) {
      const startIdx = content.indexOf(voucherStartTag, currentPos);
      if (startIdx === -1) break;

      const endIdx = content.indexOf(voucherEndTag, startIdx) + voucherEndTag.length;
      const voucherContent = content.slice(startIdx, endIdx);

      if (voucherContent.includes('ALLLEDGERENTRIES.LIST')) {
        count++;
        
        // Extract voucher number
        let voucherNumber = 'unknown';
        const vnumMatch = voucherContent.match(/<VOUCHERNUMBER>([^<]+)<\/VOUCHERNUMBER>/);
        if (vnumMatch) {
          voucherNumber = vnumMatch[1];
        }

        console.log(`\nFound voucher with ALLLEDGERENTRIES: ${voucherNumber}`);
        console.log(`Length: ${voucherContent.length} characters`);

        // Save this voucher
        const outputPath = path.join(__dirname, `complete_voucher_${voucherNumber}_${count}.xml`);
        await fs.writeFile(outputPath, voucherContent, 'utf8');
        console.log(`Saved to ${outputPath}`);
        
        // Stop after first 2
        if (count >= 2) break;
      }

      currentPos = endIdx;
    }

    if (count === 0) {
      console.log('No vouchers found with ALLLEDGERENTRIES.LIST');
    }
  } catch (err) {
    console.error('Error:', err);
  }
}

findCompleteVoucher();
