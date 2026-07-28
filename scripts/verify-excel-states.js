/**
 * Simulates what normalizeToTallyVoucher will do for each invoice
 * from the Excel file — verifies ship-to state derivation before actual export.
 */

const invoices = [
  { no: 'BIW01', name: 'SANGAMKUMAR',       add1: 'MAINCHOWKURUABAZARPRIYANKABOOTHOUSE', add2: '0 GORAKHPURUP273407' },
  { no: 'BIW02', name: 'USMANANSARI',        add1: 'RANIGANJBAJARCHAUKRANIGANJ',           add2: 'BAIRIYA BALLIAUP277208' },
  { no: 'BIW03', name: 'BABLURAJ',           add1: 'JANKIMARKETBHELAIROAD-BAZARSAMITIARA0',add2: '0 ARRAHBR802301' },
  { no: 'BIW04', name: 'SAMEERAHMED',        add1: 'OPPOSITEPUNJABBOOTHOUSECHAPPALBAZAR',  add2: 'CHAPPALBAZAR GULBARGAKA585101' },
  { no: 'BIW05', name: 'RAKESHKUMAR',        add1: 'AGGARWALBOOTHOUSEKOTANAROAD',          add2: 'NEARGOVERNMENTHOSPITAL BARAUTUP250611' },
  { no: 'BIW06', name: 'SHIVARAJCA',         add1: 'FOOTCORNERSHIGGAONSHIGGAON',           add2: 'SHIGGAON SHIGGAONKA581205' },
  { no: 'BIW07', name: 'SANJAYKUMAR',        add1: 'MANAURIBAZARUNDEROVERBRIDGE',          add2: 'NEARPANNASWEETHOUSE ALLAHABADUP212208' },
  { no: 'BIW08', name: 'SANDEEPGUPTA',       add1: 'SANDEEPSHOECENTERRATSARMANBAJAR',      add2: 'NERBYJAIMATADIGARMANT BALLIAUP277123' },
  { no: 'BIW09', name: 'PRAVEENKUMAR',       add1: 'CHANAKYAPURIKAMREKAMRERATURANCHI',     add2: '0 RANCHIJH835222' },
  { no: 'BIW10', name: 'JEEVANGULERIA',      add1: 'VILLAGEJASSURTEHSILNURPUR',            add2: 'VILLAGEJASSURTEHSILNURPUR JASSURHP176201' },
  { no: 'BIW11', name: 'PARAMJITSINGH',      add1: 'SIDHUGENERALSTOREOPPVISHALPAINTSTORE', add2: 'ADAMPUR ADAMPURPB144103' },
  { no: 'BIW12', name: 'CHITTRASENSAHOO',    add1: 'AT/PO-KANTO-BLOCK-ANANDAPUR',         add2: '0 KANTO:ANANDAPUR:KEONJHAROR758015' },
  { no: 'BIW13', name: 'SUMITHIRANI',        add1: '1682-J-17-NEWHULKORANJITNAGAR',        add2: '0 JAMNAGARGJ361005' },
  { no: 'BIW14', name: 'JAMSIRAHAMED',       add1: '125NEHRUJIROAD',                       add2: 'VILLUPURAM VILLUPURAMTN605602' },
  { no: 'BIW15', name: 'KARANGULATI',        add1: 'GULATISHOESTORE',                      add2: 'STOREGANDHICHOWK KALKAHR133302' },
  { no: 'BIW19', name: 'PRASHANTTHAKKER',    add1: 'KUKMAMAINBAJARBHUJKUTCH0',            add2: '0 BHUJGJ370105' },
  { no: 'BIW20', name: 'VIPINKUMAR',         add1: 'TREEHOUSECAFESILANIGATE',              add2: 'NEARBSNLTOWERJHAJJARJHAJJARHR124103' },
  { no: 'BIW21', name: 'ISHUSEHGAL',         add1: 'HARRAWALANEARBYCOREINTERNATIONALSCHOOL',add2: 'DEHRADUNUL248001' },
  { no: 'BIW22', name: 'KANARAMSIRVI',       add1: 'LALITHASHOECENTERGANAPATINAGAR',       add2: 'RAJAGOPALNAGARMAINROAD BANGALOREKA560058' },
  { no: 'BIW27', name: 'BHASKARBHASKAR',     add1: '219NSCBOSEROADPARRYS',               add2: '219NSCBOSEROADPARRYS CHENNAITN600001' },
  { no: 'BIW30', name: 'KAMALANSARI',        add1: 'BADARPURJAITPURISMAILPURROAD',        add2: 'BADARPURJAITPUR DELHIDL110044' },
  { no: 'BIW36', name: 'SANTOSHSAHOO',       add1: 'SUAKATISUAKATI',                      add2: 'SUAKATI KEONJHAROR758018' },
  { no: 'BIW60', name: 'TAPASDEBNATH',       add1: 'FANCYSHOE(BELUR)BELURSTATIONROAD',   add2: '0 BELURWB711201' },
  { no: 'BIW84', name: 'NEELU DESHMUKH',     add1: 'GEEDAM BUS STANDVARSHA FOOTWEAR',    add2: 'FRONT OF BHAGWATI JWELLERYGEEDAMCT494441' },
  { no: 'BIW100',name: 'NISHANTHI R',        add1: 'NO.9A-KARNAM STREET',                 add2: 'SELAIYUR CHENNAITN600073' },
];

// ── Same pincode map as normalizeToTallyVoucher.js ──
const deriveStateFromPin = (pin) => {
  if (pin >= 110001 && pin <= 110999) return 'Delhi';
  if (pin >= 120001 && pin <= 135999) return 'Haryana';
  if (pin >= 140001 && pin <= 160099) return 'Punjab';
  if (pin >= 171001 && pin <= 177999) return 'Himachal Pradesh';
  if (pin >= 180001 && pin <= 194599) return 'Jammu and Kashmir';
  if (pin >= 201001 && pin <= 285999) return 'Uttar Pradesh';
  if (pin >= 301001 && pin <= 345999) return 'Rajasthan';
  if (pin >= 360001 && pin <= 396999) return 'Gujarat';
  if (pin >= 400001 && pin <= 445999) return 'Maharashtra';
  if (pin >= 450001 && pin <= 480999) return 'Madhya Pradesh';
  if (pin >= 481001 && pin <= 497999) return 'Chhattisgarh';
  if (pin >= 491001 && pin <= 497999) return 'Chhattisgarh';
  if (pin >= 500001 && pin <= 514999) return 'Telangana';
  if (pin >= 515001 && pin <= 535999) return 'Andhra Pradesh';
  if (pin >= 560001 && pin <= 591999) return 'Karnataka';
  if (pin >= 600001 && pin <= 643999) return 'Tamil Nadu';
  if (pin >= 670001 && pin <= 695999) return 'Kerala';
  if (pin >= 700001 && pin <= 743999) return 'West Bengal';
  if (pin >= 751001 && pin <= 770099) return 'Odisha';
  if (pin >= 781001 && pin <= 788999) return 'Assam';
  if (pin >= 800001 && pin <= 813999) return 'Bihar';
  if (pin >= 814001 && pin <= 835999) return 'Jharkhand';
  if (pin >= 160101 && pin <= 160163) return 'Chandigarh';
  if (pin >= 737101 && pin <= 737139) return 'Sikkim';
  if (pin >= 799001 && pin <= 799290) return 'Tripura';
  return null;
};

// State code suffix map (2-letter codes at end of address)
const STATE_SUFFIX = {
  'UP': 'Uttar Pradesh', 'BR': 'Bihar', 'JH': 'Jharkhand',
  'KA': 'Karnataka',     'TN': 'Tamil Nadu', 'TG': 'Telangana',
  'AP': 'Andhra Pradesh','MH': 'Maharashtra','GJ': 'Gujarat',
  'RJ': 'Rajasthan',     'PB': 'Punjab',     'HR': 'Haryana',
  'HP': 'Himachal Pradesh','DL':'Delhi',      'WB': 'West Bengal',
  'OR': 'Odisha',        'MP': 'Madhya Pradesh','CG':'Chhattisgarh',
  'CT': 'Chhattisgarh',  'KL': 'Kerala',     'AS': 'Assam',
  'UL': 'Uttarakhand',   'UK': 'Uttarakhand','GA':'Goa',
};

const resolveState = (add1, add2) => {
  const fullAddr = `${add1} ${add2}`.toUpperCase();
  
  // 1. Extract pincode
  const pinMatch = fullAddr.match(/(?<![0-9])(\d{6})(?![0-9])/);
  if (pinMatch) {
    const pin = parseInt(pinMatch[1], 10);
    const stateFromPin = deriveStateFromPin(pin);
    if (stateFromPin) return { state: stateFromPin, method: `pincode ${pinMatch[1]}` };
  }

  // 2. State code suffix before pincode (e.g. "UP277208", "TN600073")
  const suffixMatch = fullAddr.match(/([A-Z]{2})(\d{6})/);
  if (suffixMatch) {
    const code = suffixMatch[1];
    if (STATE_SUFFIX[code]) return { state: STATE_SUFFIX[code], method: `state code ${code}` };
  }

  return { state: '❌ NOT DERIVED', method: 'none' };
};

console.log('\n=== EXCEL STATE DERIVATION CHECK ===\n');
console.log('Invoice  | Ship To State          | Method');
console.log('---------|------------------------|---------------------------');

let ok = 0, fail = 0;
for (const inv of invoices) {
  const { state, method } = resolveState(inv.add1, inv.add2);
  const status = state.startsWith('❌') ? '❌' : '✓';
  if (status === '✓') ok++; else fail++;
  console.log(`${inv.no.padEnd(8)} | ${state.padEnd(22)} | ${method}`);
}

console.log(`\nTotal: ${ok} ✓  ${fail} ❌`);
