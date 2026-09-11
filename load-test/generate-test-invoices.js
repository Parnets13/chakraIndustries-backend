/**
 * generate-test-invoices.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generates a realistic 1,000-row invoice Excel file (.xlsx) for the Chakra
 * backend load test.
 *
 * SAFE:
 *   - Creates ONLY a local Excel file on disk.
 *   - Does NOT connect to MongoDB, the backend, or Tally.
 *   - Does NOT modify any existing application code or data.
 *
 * Usage:
 *   node load-test/generate-test-invoices.js
 *
 * Output:
 *   load-test/test-invoices-1000.xlsx
 * ─────────────────────────────────────────────────────────────────────────────
 */

import XLSX      from 'xlsx';
import path      from 'path';
import fs        from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Realistic Indian company/party data ──────────────────────────────────────
const PARTIES = [
  'BI Worldwide India PVT LTD',
  'Reliance Retail Ltd',
  'Tata Consultancy Services',
  'Infosys BPM Limited',
  'Wipro Technologies Ltd',
  'HCL Technologies',
  'Mahindra and Mahindra Ltd',
  'Larsen and Toubro Ltd',
  'Bajaj Auto Ltd',
  'Hero MotoCorp Ltd',
  'Maruti Suzuki India Ltd',
  'Sun Pharmaceutical Industries',
  'Dr Reddy Laboratories',
  'Cipla Limited',
  'Asian Paints Ltd',
  'Hindustan Unilever Ltd',
  'ITC Limited',
  'Nestle India Ltd',
  'Godrej Consumer Products',
  'Dabur India Ltd',
];

const ITEMS = [
  { name: 'SS Water Bottle 500ml',        hsn: '7323', rate: 350,  unit: 'Nos' },
  { name: 'SS Water Bottle 1L',           hsn: '7323', rate: 480,  unit: 'Nos' },
  { name: 'SS Casserole Set 3pc',         hsn: '7323', rate: 1200, unit: 'Set' },
  { name: 'SS Dinner Set 27pc',           hsn: '7323', rate: 2800, unit: 'Set' },
  { name: 'SS Tiffin Box 3 Tier',         hsn: '7323', rate: 650,  unit: 'Nos' },
  { name: 'SS Pressure Cooker 3L',        hsn: '7321', rate: 1800, unit: 'Nos' },
  { name: 'SS Pressure Cooker 5L',        hsn: '7321', rate: 2200, unit: 'Nos' },
  { name: 'SS Frying Pan 26cm',           hsn: '7323', rate: 950,  unit: 'Nos' },
  { name: 'SS Kadhai 2L',                 hsn: '7323', rate: 780,  unit: 'Nos' },
  { name: 'SS Tea Kettle 1.5L',           hsn: '7323', rate: 560,  unit: 'Nos' },
  { name: 'SS Storage Container 1L',      hsn: '7323', rate: 220,  unit: 'Nos' },
  { name: 'SS Storage Container Set 5pc', hsn: '7323', rate: 890,  unit: 'Set' },
  { name: 'SS Plate 26cm',               hsn: '7323', rate: 180,  unit: 'Nos' },
  { name: 'SS Bowl 350ml',               hsn: '7323', rate: 120,  unit: 'Nos' },
  { name: 'SS Spoon Set 6pc',            hsn: '7323', rate: 240,  unit: 'Set' },
];

const STATES = [
  'Tamil Nadu', 'Maharashtra', 'Karnataka', 'Gujarat',
  'Delhi', 'Rajasthan', 'Uttar Pradesh', 'West Bengal',
  'Telangana', 'Andhra Pradesh',
];

const SHIP_TO = [
  { name: 'BI Worldwide Warehouse Chennai', addr: 'Plot 45, SIDCO Industrial Estate',  city: 'Chennai',   state: 'Tamil Nadu'    },
  { name: 'Reliance DC Mumbai',             addr: '7th Floor, Maker Chambers IV',      city: 'Mumbai',    state: 'Maharashtra'   },
  { name: 'Infosys Campus Bengaluru',       addr: 'Electronics City Phase 1',          city: 'Bengaluru', state: 'Karnataka'     },
  { name: 'TCS Hyderabad Hub',             addr: 'TCS Synergy Park, Gachibowli',      city: 'Hyderabad', state: 'Telangana'     },
  { name: 'HCL Noida Campus',              addr: 'A-10/11, Sector 3',                 city: 'Noida',     state: 'Uttar Pradesh' },
];

// ── Ledger mapping per item family ────────────────────────────────────────────
// These match the typical tallySalesLedger values you'd have in ItemMaster.
// They are included in the Excel so the bulk-upload seeds them into ItemMaster.
function ledgerFor(itemName) {
  if (itemName.includes('Bottle'))    return 'SS Bottle Sales Local 18%';
  if (itemName.includes('Cooker'))    return 'SS Cookware Sales Local 18%';
  if (itemName.includes('Frying') || itemName.includes('Kadhai')) return 'SS Cookware Sales Local 18%';
  if (itemName.includes('Plate') || itemName.includes('Bowl') || itemName.includes('Spoon')) return 'SS Tableware Sales Local 5%';
  if (itemName.includes('Container')) return 'SS Container Sales Local 18%';
  return 'Sales Accounts';
}

// ── Random helpers ────────────────────────────────────────────────────────────
const rnd  = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr)      => arr[Math.floor(Math.random() * arr.length)];

function fmtDate(d) {
  const dd   = String(d.getDate()).padStart(2, '0');
  const mm   = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// ── Build 1,000 rows ──────────────────────────────────────────────────────────
const rows = [];

for (let i = 1; i <= 1000; i++) {
  const party       = pick(PARTIES);
  const item        = pick(ITEMS);
  const shipTo      = pick(SHIP_TO);
  const invoiceDate = daysAgo(rnd(0, 90));
  const poDate      = daysAgo(rnd(91, 150));
  const dueDate     = new Date(invoiceDate.getTime() + 30 * 86400000);

  const qty   = rnd(2, 50);
  const rate  = item.rate + rnd(-50, 100);
  const basic = Math.round(qty * rate * 100) / 100;

  // Every other invoice uses IGST (inter-state), the rest use CGST+SGST (intra-state)
  const isInterState = (i % 2 === 0);
  const cgst = isInterState ? 0 : Math.round(basic * 0.09 * 100) / 100;
  const sgst = isInterState ? 0 : Math.round(basic * 0.09 * 100) / 100;
  const igst = isInterState ? Math.round(basic * 0.18 * 100) / 100 : 0;
  const total = Math.round((basic + cgst + sgst + igst) * 100) / 100;

  rows.push({
    // ── Invoice header ──────────────────────────────────────────────────────
    'Invoice No':          `LOAD-${String(i).padStart(4, '0')}`,
    'Invoice Date':        fmtDate(invoiceDate),
    'Due Date':            fmtDate(dueDate),
    'PO Number':           `PO-LOAD-${String(i).padStart(4, '0')}`,
    'PO Date':             fmtDate(poDate),

    // ── Billing party ───────────────────────────────────────────────────────
    'Party Name':          party,
    'Party GST':           `27AADCB2230M1Z${i % 10}`,
    'Party Address':       `${rnd(1, 999)}, Industrial Area Phase ${rnd(1, 4)}`,
    'Party State':         pick(STATES),

    // ── Ship To ─────────────────────────────────────────────────────────────
    'Ship To Name':        shipTo.name,
    'Ship To Address':     shipTo.addr,
    'Ship To City':        shipTo.city,
    'Ship To State':       shipTo.state,

    // ── Line item ───────────────────────────────────────────────────────────
    'Item Description':    item.name,
    'HSN':                 item.hsn,
    'Qty':                 qty,
    'Unit':                item.unit,
    'Rate':                rate,
    'Basic Amount':        basic,
    'CGST Amount':         cgst,
    'SGST Amount':         sgst,
    'IGST Amount':         igst,
    'Total Amount':        total,
    'Tally Sales Ledger':  ledgerFor(item.name),

    // ── Meta ────────────────────────────────────────────────────────────────
    'Status':              'Draft',
    'Narration':           `Load test invoice ${i} — batch LOADTEST-2026`,
  });
}

// ── Write Excel file ──────────────────────────────────────────────────────────
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(rows);

// Auto-fit column widths (generous)
ws['!cols'] = Object.keys(rows[0]).map(k => ({ wch: Math.max(k.length + 2, 20) }));

XLSX.utils.book_append_sheet(wb, ws, 'Invoices');

const outPath = path.join(__dirname, 'test-invoices-1000.xlsx');
XLSX.writeFile(wb, outPath);

const fileSizeKB = (fs.statSync(outPath).size / 1024).toFixed(1);

console.log('');
console.log('✓ Excel file generated successfully');
console.log(`  Rows     : ${rows.length} invoices`);
console.log(`  Parties  : ${PARTIES.length} unique companies`);
console.log(`  Items    : ${ITEMS.length} unique products`);
console.log(`  File     : ${outPath}`);
console.log(`  Size     : ${fileSizeKB} KB`);
console.log('');
console.log('Next step: node load-test/load-test-runner.js');
