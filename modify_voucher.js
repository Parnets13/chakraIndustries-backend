
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function modifyVoucher() {
  const inputPath = path.join(__dirname, 'sci0937_full.xml');
  const outputPath = path.join(__dirname, 'subtract01_test.xml');
  
  try {
    let content = await fs.readFile(inputPath, 'utf8');
    
    // 1. Change voucher number to SUBTRACT01
    content = content.replace('<VOUCHERNUMBER>SCI0937</VOUCHERNUMBER>', '<VOUCHERNUMBER>SUBTRACT01</VOUCHERNUMBER>');
    
    // 2. Remove internal attributes from <VOUCHER> tag
    // Remove REMOTEID, VCHKEY from opening tag
    content = content.replace(/<VOUCHER[^>]*>/, (match) => {
      return match
        .replace(/\s+REMOTEID="[^"]*"/g, '')
        .replace(/\s+VCHKEY="[^"]*"/g, '');
    });
    
    // 3. Remove internal tags
    const tagsToRemove = [
      'GUID',
      'ALTERID',
      'MASTERID',
      'VOUCHERKEY',
      'VOUCHERRETAINKEY',
      'REMOTEALTERID',
      'QRCODECRC',
      'EXCHANGEACTIVITYID',
      'REUSEHOLEID',
      'UPDATEDDATETIME'
    ];
    
    tagsToRemove.forEach(tag => {
      const regex = new RegExp(`\\s*<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
      content = content.replace(regex, '');
    });
    
    // Also clean up any empty lines left behind
    content = content.replace(/\n\s*\n/g, '\n');
    
    // Save the modified voucher
    await fs.writeFile(outputPath, content, 'utf8');
    console.log(`Modified voucher saved to ${outputPath}`);
    console.log('\n=== Modified Voucher ===\n');
    console.log(content);
    
  } catch (err) {
    console.error('Error:', err);
  }
}

modifyVoucher();
