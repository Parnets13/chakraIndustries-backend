import fs from 'fs';

const xml = fs.readFileSync('./tally-xml-response.xml', 'utf8');

// Find first voucher
const voucherMatch = xml.match(/<VOUCHER>([\s\S]*?)<\/VOUCHER>/);
if (voucherMatch) {
  const voucher = voucherMatch[0];
  console.log('First voucher structure (first 5000 chars):\n');
  console.log(voucher.substring(0, 5000));
  
  // Extract all unique tag names
  const tags = new Set();
  const tagRegex = /<(\w+)>/g;
  let match;
  while ((match = tagRegex.exec(voucher)) !== null) {
    tags.add(match[1]);
  }
  
  console.log('\n\n📊 All unique tags in this voucher:');
  Array.from(tags).sort().forEach(tag => {
    const count = (voucher.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    console.log(`  ${tag} (${count})`);
  });
}
