import fs from 'fs';

const xml = fs.readFileSync('./tally-xml-response.xml', 'utf8');

// Find vouchers with VOUCHERNUMBER="SCI01"
const sci01Match = xml.match(/<VOUCHER>([\s\S]*?<VOUCHERNUMBER>SCI01<\/VOUCHERNUMBER>[\s\S]*?)<\/VOUCHER>/);

if (sci01Match) {
  const full = sci01Match[0];
  console.log('=== VOUCHER WITH SCI01 (first 6000 chars) ===\n');
  console.log(full.substring(0, 6000));
  console.log('\n...truncated...\n');
  console.log(`Total size: ${full.length} chars\n`);
  
  // Extract all unique tags
  const tags = new Set();
  const tagRegex = /<(\w+)>/g;
  let match;
  while ((match = tagRegex.exec(full)) !== null) {
    tags.add(match[1]);
  }
  
  console.log('📊 ALL TAGS IN THIS VOUCHER:');
  Array.from(tags).sort().forEach(tag => {
    const count = (full.match(new RegExp(`<${tag}>`, 'g')) || []).length;
    console.log(`  ${tag} (${count}x)`);
  });
  
  // Check for specific fields
  console.log('\n🔍 IMPORTANT FIELD CHECK:');
  console.log(`  Has AMOUNT: ${full.includes('<AMOUNT>') ? '✅ YES' : '❌ NO'}`);
  console.log(`  Has ALLLEDGERENTRIES: ${full.includes('ALLLEDGERENTRIES') ? '✅ YES' : '❌ NO'}`);
  console.log(`  Has ALLINVENTORYENTRIES: ${full.includes('ALLINVENTORYENTRIES') ? '✅ YES' : '❌ NO'}`);
  console.log(`  Has LEDGERNAME: ${full.includes('<LEDGERNAME>') ? '✅ YES' : '❌ NO'}`);
  console.log(`  Has STOCKITEMNAME: ${full.includes('<STOCKITEMNAME>') ? '✅ YES' : '❌ NO'}`);
} else {
  console.log('No voucher found with SCI01');
}
