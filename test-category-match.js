// test-category-match.js — Verifies matchCategoryLedger picks the right ledger
// for the problem items, using the known live Tally sales-ledger list.
import { matchCategoryLedger } from './services/tallyExportService.js';

// The confirmed-working ledgers that exist in Tally (from earlier fetch)
const LEDGERS = [
  'Air Cooler Sales Local','Air Fryer Sales Local','Ceiling Fan Sales Local',
  'Coffee Maker Sales Local','Dry Iron Sales Local','Fan Heater Sale Local',
  'Induction Cooktop','Mixer Grinder Local Sales','Neck Pillow Sales Local',
  'Toasters sales loacal','Veg Chopper Sales Local','Water Heater Sales Local',
  'Water Purifier Sales Local',
];

const TESTS = [
  'Glo Star Copper Water Purifier 8 Stage RO+UV+UF',
  'Envy Alkaline RO+UV+UF+Smart TDS Water Purifier',
  'Livpure Envy Alkaline WAAS RO+UV+UF',
  'LIV-COOLMIST-48L',
  'LIV-DRIFT-PLUS-60-FL-HAC-INCLINED',
  'Livpure-Celestia-4 Burner-Auto Ignition',
  'ICX 160TS Neo Induction Stove',
  'IRX 220F Infrarred Cooktop',
  'Europa Drip Espresso Coffee Machine',
  'DRY IRON SLEEK DLX PRO',
  'Electric Dry Iron Panache Plus 1100W',
  'ELECTRIC KETTLE VIVA XPRESS 1.5L',
  'Electric Quartz Heater Instahot 800W',
  'Electric Stand 32 Pedestal Fan',
];

console.log('Item → matched ledger');
console.log('─'.repeat(70));
for (const t of TESTS) {
  const m = matchCategoryLedger(LEDGERS, t, false);
  console.log(`${t.slice(0,45).padEnd(45)} → ${m || '(no match)'}`);
}
process.exit(0);
