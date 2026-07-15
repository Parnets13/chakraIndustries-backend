
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getSci0918() {
  const filePath = path.join(__dirname, 'tally-xml-response.xml');
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const voucherStartTag = '<VOUCHER';
    const voucherEndTag = '</VOUCHER>';
    
    let currentPos = 0;
    let found = false;
    
    while (true) {
      const startIdx = content.indexOf(voucherStartTag, currentPos);
      if (startIdx === -1) break;
      
      const endIdx = content.indexOf(voucherEndTag, startIdx) + voucherEndTag.length;
      const voucherContent = content.slice(startIdx, endIdx);
      
      if (voucherContent.includes('<VOUCHERNUMBER>SCI0918</VOUCHERNUMBER>')) {
        console.log('\n=== FOUND FULL SCI0918 VOUCHER ===\n');
        console.log(voucherContent);
        
        const outputPath = path.join(__dirname, 'sci0918_full.xml');
        await fs.writeFile(outputPath, voucherContent, 'utf8');
        console.log(`\nSaved full voucher to ${outputPath}`);
        found = true;
        break;
      }
      
      currentPos = endIdx;
    }
    
    if (!found) {
      console.log('SCI0918 not found');
    }
  } catch (err) {
    console.error(err);
  }
}

getSci0918();
