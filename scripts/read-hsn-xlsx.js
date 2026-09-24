// One-off: read the HSN Code.xlsx and dump all rows + a category->hsn summary.
import xlsx from 'xlsx';

const path = process.argv[2] || 'd:\\chakraproject\\HSN Code.xlsx';
const wb = xlsx.readFile(path);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { defval: '' }); // objects keyed by header

console.log('TOTAL:', rows.length);

// category -> set of HSNs (to see if each category has ONE consistent HSN)
const catMap = new Map();
for (const r of rows) {
  const cat = String(r.Category || '').trim();
  const hsn = String(r.HsnCode || '').trim();
  if (!catMap.has(cat)) catMap.set(cat, new Set());
  catMap.get(cat).add(hsn);
}
console.log('\n=== CATEGORY -> HSN(s) ===');
for (const [cat, set] of catMap) {
  console.log(`${cat}  ->  ${[...set].join(', ')}`);
}

console.log('\n=== ALL ROWS (hsn | category | product) ===');
for (const r of rows) {
  console.log(`${String(r.HsnCode||'').trim()} | ${String(r.Category||'').trim()} | ${String(r.ProductName||'').trim()}`);
}
