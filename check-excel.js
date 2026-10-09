// check-excel.js — READ ONLY. Reads the source Excel and checks each row's tax:
//   - derive rate from cgst/base, confirm it snaps to a GST slab
//   - flag rows where CGST != SGST in the Excel
//   - flag the 1-paisa edge rows (equal-halves total != full-rate round)
import xlsx from 'xlsx';
import path from 'path';

const FILE = process.argv[2] || 'D:/chakraproject/BI Bills 09-10-2026.xlsx';
const r2 = n => +(+n).toFixed(2);
const SLABS = [0,2.5,5,6,9,12,14,18,28];
const snap = r => r<=0?0:SLABS.reduce((b,s)=>Math.abs(s-r)<Math.abs(b-r)?s:b,0);

const wb = xlsx.readFile(FILE);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

console.log(`File: ${FILE}`);
console.log(`Sheet: ${wb.SheetNames[0]}  Rows: ${rows.length}`);
console.log(`Columns: ${Object.keys(rows[0]||{}).join(' | ')}\n`);

// Try to detect the relevant columns
const keys = Object.keys(rows[0]||{});
const find = (...names) => keys.find(k => names.some(n => k.toLowerCase().replace(/[^a-z]/g,'').includes(n)));
const cBase = find('taxable','basic','assessable','amount');
const cCgst = find('cgst');
const cSgst = find('sgst');
const cIgst = find('igst');
const cInv  = find('invoiceno','invoice','billno','voucher');

console.log(`Detected → base:"${cBase}" cgst:"${cCgst}" sgst:"${cSgst}" igst:"${cIgst}" inv:"${cInv}"\n`);

let edge = 0, cgstNeSgst = 0, badRate = 0, ok = 0;
const samples = [];

rows.forEach((row, i) => {
  const base = +(`${row[cBase]}`.replace(/[^0-9.]/g,'')) || 0;
  const cg   = +(`${row[cCgst]}`.replace(/[^0-9.]/g,'')) || 0;
  const sg   = +(`${row[cSgst]}`.replace(/[^0-9.]/g,'')) || 0;
  const ig   = +(`${row[cIgst]}`.replace(/[^0-9.]/g,'')) || 0;
  const inv  = row[cInv] || `row${i+2}`;
  if (base <= 0) return;

  if (ig > 0) { ok++; return; } // interstate, skip for this intrastate check

  if (Math.abs(cg - sg) > 0.005) { cgstNeSgst++; if(samples.length<10) samples.push(`${inv}: Excel CGST ${cg} != SGST ${sg}`); }

  const rate = snap(+(cg/base*100).toFixed(4));
  if (rate === 0 && cg > 0) { badRate++; }

  // edge: equal halves (round base*half each) total vs full-rate round
  const half = r2(base * rate / 100);
  const equalSum = r2(half*2);
  const fullRound = r2(base * (rate*2) / 100);
  if (Math.abs(equalSum - fullRound) > 0.005) edge++;

  ok++;
});

console.log('═══ EXCEL TAX CHECK ═══');
console.log(`  Rows with tax: ${ok}`);
console.log(`  Excel CGST != SGST: ${cgstNeSgst}`);
console.log(`  Rate not snapping to a slab: ${badRate}`);
console.log(`  1-paisa edge rows (need Tally 'ignore up to 1'): ${edge}`);
if (samples.length){ console.log('\nCGST!=SGST samples:'); samples.forEach(s=>console.log('  '+s)); }
console.log('\nNOTE: our code recomputes CGST=SGST=ROUND(base×half) regardless of Excel,');
console.log('so Excel CGST!=SGST does NOT break export. The edge rows need the Tally');
console.log('"Ignore difference in tax values up to 1" setting to pass e-invoice.');
