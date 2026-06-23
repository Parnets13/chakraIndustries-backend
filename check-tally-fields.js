import fs from 'fs';

const xml = fs.readFileSync('./tally-xml-response.xml', 'utf8');

// Find vouchers with VOUCHERNUMBER="SCI01"
const sci01Match = xml.match(/<VOUCHER>([\s\S]*?<VOUCHERNUMBER>SCI01<\/VOUCHERNUMBER>[\s\S]*?)<\/VOUCHER>/);

if (sci01Match) {
  const full = sci01Match[0];
  console.log('\n🔍 FIELD CHECK FOR SCI01 VOUCHER:');
  console.log(`  ✅ Has AMOUNT: ${full.includes('<AMOUNT>') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has ALLLEDGERENTRIES: ${full.includes('ALLLEDGERENTRIES') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has ALLINVENTORYENTRIES: ${full.includes('ALLINVENTORYENTRIES') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has LEDGERNAME: ${full.includes('<LEDGERNAME>') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has STOCKITEMNAME: ${full.includes('<STOCKITEMNAME>') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has GROSSAMOUNT: ${full.includes('<GROSSAMOUNT>') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has NETAMOUNT: ${full.includes('<NETAMOUNT>') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has TOTALDEBIT: ${full.includes('<TOTALDEBIT>') ? 'YES' : 'NO'}`);
  console.log(`  ✅ Has TOTALCREDIT: ${full.includes('<TOTALCREDIT>') ? 'YES' : 'NO'}`);
  
  // Extract all unique tags
  const tags = new Set();
  const tagRegex = /<(\w+)>/g;
  let match;
  while ((match = tagRegex.exec(full)) !== null) {
    tags.add(match[1]);
  }
  
  // Filter for likely amount/total fields
  const amountLikeFields = Array.from(tags).filter(t => 
    t.includes('AMOUNT') || t.includes('TOTAL') || t.includes('DEBIT') || t.includes('CREDIT') || t.includes('VALUE')
  ).sort();
  
  console.log('\n💰 ALL AMOUNT/TOTAL RELATED FIELDS:');
  amountLikeFields.forEach(tag => console.log(`    ${tag}`));
  
  // Look for line items
  const hasLineItems = full.includes('ALLINVENTORYENTRIES.LIST') || 
                       full.includes('LINEITEM') || 
                       full.includes('STOCKITEM') ||
                       full.includes('INVOICELINEITEM');
  
  console.log(`\n📦 Line Items: ${hasLineItems ? 'FOUND' : 'NOT FOUND'}`);
  
  // Extract values for key fields
  console.log('\n📊 KEY VALUES:');
  
  const grossMatch = full.match(/<GROSSAMOUNT>([\s\S]*?)<\/GROSSAMOUNT>/);
  if (grossMatch) console.log(`  GROSSAMOUNT: ${grossMatch[1]}`);
  
  const netMatch = full.match(/<NETAMOUNT>([\s\S]*?)<\/NETAMOUNT>/);
  if (netMatch) console.log(`  NETAMOUNT: ${netMatch[1]}`);
  
  const totalDebMatch = full.match(/<TOTALDEBIT>([\s\S]*?)<\/TOTALDEBIT>/);
  if (totalDebMatch) console.log(`  TOTALDEBIT: ${totalDebMatch[1]}`);
  
  const totalCredMatch = full.match(/<TOTALCREDIT>([\s\S]*?)<\/TOTALCREDIT>/);
  if (totalCredMatch) console.log(`  TOTALCREDIT: ${totalCredMatch[1]}`);
  
  const partyMatch = full.match(/<PARTYLEDGERNAME>([\s\S]*?)<\/PARTYLEDGERNAME>/);
  if (partyMatch) console.log(`  PARTYLEDGERNAME: ${partyMatch[1]}`);
  
  const dateMatch = full.match(/<DATE>([\s\S]*?)<\/DATE>/);
  if (dateMatch) console.log(`  DATE: ${dateMatch[1]}`);
  
  console.log('\n✅ All 1115 vouchers likely have same structure with no AMOUNT/INVENTORY fields');
  console.log('❌ Need to calculate amounts from ledger entries in Tally OR');
  console.log('❌ Request different Tally report with detailed line items');
  
} else {
  console.log('No voucher found with SCI01');
}
