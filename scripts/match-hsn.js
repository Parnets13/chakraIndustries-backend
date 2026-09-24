// REPORT ONLY — no DB writes. Match the 22 pending-invoice items to an HSN using:
//   1) exact-ish name match against the sheet ProductName (normalized)
//   2) fallback: category keyword rules
import xlsx from 'xlsx';

const XLSX_PATH = process.argv[2] || 'd:\\chakraproject\\HSN Code.xlsx';

// the 22 items currently sitting on pending (un-exported) invoices
const PENDING = [
  'Rico Rechargeble Electric Chopper',
  'Liv-Glo-Star-Copper(RO+UV+UF+CU)',
  'Liv-Envy-Alkaline(RO+UV+UF+Alkaline)',
  'LIV-BOLT-WAAS',
  'GC Digital Air Fryer Frizzle 4.2L',
  'Livpure Travel Neck Pillow 11x11x3',
  'Electric Dry Iron Panache Crystal 1100W',
  'Electric Dry Iron Kratos Ultimate Plus 1100W',
  'Bajaj IRX 220F Infrared Cooktop',
  'Rico Steam Iron SI03',
  'Greenchef Mixer Grinder Strobe (3 Jars)',
  'Electric Dry Iron Fabrishine 1000W',
  'Electric Dry Iron Panache 1000W',
  'Electric Maveric Storage Water Heater 25Ltr',
  'LIV-ZINGER-COPPER-HOT-HR(RO+UV+UF)',
  'Multicool Mini Desert Air Cooler- 60L',
  'Orient Fabrismooth 1000W Dry Iron',
  'Chill Air Cooler-35 L',
  'Electric Aeon Bldc Ceiling Fan With Remote',
  'Electric Arc Plus Immersion Rod',
  'Electric Maveric Storage Water Heater 15Ltr',
  'Europa Drip 600-Watt 5 Cup Drip Coffee',
];

const norm = (s) => String(s||'')
  .toLowerCase()
  .replace(/&#\d+;?/g,' ')
  .replace(/[^a-z0-9]+/g,' ')
  .trim();

// keyword -> HSN fallback rules (from the sheet's category summary)
// Overrides that WIN over both name + keyword match.
// Chopper uses the HSN that already exported successfully (BIW2459/BIW2492): 39241090.
const OVERRIDES = [
  [/rico.*choper|rico.*chopper|rechargeble electric chopper|rechargeable electric chopper/, '39241090'],
  [/rico steam iron/, '85161000'],  // sheet row "Rico Steam Iron - Model SI 03" = 85161000
];

const KEYWORDS = [
  [/\bchopper\b/, '96170012'],   // sheet: Chopper -> 96170012 (rechargeable variant lists 85094090; we use 96170012 as primary per FRISCO/CH2509 rows)
  [/water purifier|purifier|\bro\b|ro\+uv|glo|zinger|envy|bolt|allura|glitz/, '84212190'],
  [/air fryer|fryer/, '85167990'],
  [/neck pillow|pillow/, '94042190'],
  [/water heater|geyser|immersion|storage water/, '85161000'],
  [/steam iron/, '85161000'],
  [/dry iron|\biron\b/, '85164000'],
  [/ceiling fan/, '84133030'],   // Orient Aeon BLDC ceiling fan -> 84133030
  [/air cooler|cooler|coolmist|multicool/, '84796000'],
  [/mixer grinder|mixer|grinder/, '85094010'],
  [/induction|cooktop|infrared/, '85166000'],
  [/coffee/, '85167100'],
  [/kettle/, '85166000'],
];

const wb = xlsx.readFile(XLSX_PATH);
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(ws, { defval: '' });

// build normalized product -> hsn from the sheet
const sheetByName = rows.map(r => ({
  n: norm(r.ProductName),
  hsn: String(r.HsnCode||'').trim(),
  cat: String(r.Category||'').trim(),
  raw: String(r.ProductName||'').trim(),
}));

function matchName(itemNorm) {
  // best fuzzy: sheet product whose normalized string shares the most word overlap
  const w = new Set(itemNorm.split(' ').filter(Boolean));
  let best = null, bestScore = 0;
  for (const s of sheetByName) {
    const sw = s.n.split(' ').filter(Boolean);
    let hit = 0;
    for (const t of sw) if (w.has(t)) hit++;
    const score = hit / Math.max(sw.length, 1);
    if (hit >= 2 && score > bestScore) { bestScore = score; best = s; }
  }
  return best && bestScore >= 0.5 ? best : null;
}

function matchKeyword(itemNorm) {
  for (const [re, hsn] of KEYWORDS) if (re.test(itemNorm)) return hsn;
  return '';
}

console.log('ITEM | HSN | SOURCE | matchedSheetProduct');
const out = {};
for (const item of PENDING) {
  const inNorm = norm(item);
  let hsn = '', src = '', matched = '';
  const ov = OVERRIDES.find(([re]) => re.test(inNorm));
  if (ov) { hsn = ov[1]; src = 'override'; }
  else {
    const nm = matchName(inNorm);
    if (nm) { hsn = nm.hsn; src = 'name'; matched = nm.raw; }
    else { const kw = matchKeyword(inNorm); if (kw) { hsn = kw; src = 'keyword'; } }
  }
  out[item] = hsn;
  console.log(`${item} | ${hsn||'(none)'} | ${src||'-'} | ${matched}`);
}

console.log('\n=== JSON map (for /set-hsn) ===');
console.log(JSON.stringify({ map: out }, null, 2));
