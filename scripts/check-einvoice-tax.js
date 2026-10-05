// REPORT ONLY — check if CGST/SGST amounts match taxable value × rate
// for the failing invoices (BIW2432 onwards)
import xlsx from 'xlsx';

const PATH = process.argv[2] || 'd:\\chakraproject\\11-09-2026 - BIW.xlsx';
const wb = xlsx.readFile(PATH);

console.log('SHEETS:', wb.SheetNames);

const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });

// Print first 5 rows to see column headers
console.log('\nFIRST 5 ROWS (to see columns):');
for (let i = 0; i < Math.min(5, rows.length); i++) {
  console.log(i, JSON.stringify(rows[i]));
}

// Print all rows as objects with header
const data = xlsx.utils.sheet_to_json(ws, { defval: '' });
console.log('\nCOLUMN NAMES:', Object.keys(data[0] || {}));
console.log('\nTOTAL DATA ROWS:', data.length);

// Find invoice number column
const sample = data[0] || {};
const keys = Object.keys(sample);
console.log('\nSAMPLE ROW:', JSON.stringify(data[0]));
