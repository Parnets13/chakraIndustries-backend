// Quick test of address extraction logic
const testAddresses = [
  "BASHA FOOTWEARSADUMNEAR POLICE STATION, SADUMAP517123",
  "CHINNAMMATHALLI FANCY FOOTWEARNEAR RTC COMPLEXRAMBHADRAPURAM-, VIZIANAGARAMAP535579",
  "BANDLA STREETTIRUPATI, TIRUPATIAP517501",
  "PRIME FOOT WEAR VIZIANAGARAMKORADA STREETKORADASTREETVIZIANAGARAM, VIZIANAGARAMAP535003",
  "ROYAL SHOES19-1-3-MANTHAVARI STREET-1ST FLOOROPP. KHADI INDIA-, VISAKHAPATNAMAP530002",
];

const STATE_MAP_BY_PIN = (pin) => {
  pin = parseInt(pin, 10);
  if      (pin >= 110001 && pin <= 110099) return 'Delhi';
  else if (pin >= 120001 && pin <= 135999) return 'Haryana';
  else if (pin >= 140001 && pin <= 160099) return 'Punjab';
  else if (pin >= 171001 && pin <= 177999) return 'Himachal Pradesh';
  else if (pin >= 180001 && pin <= 194599) return 'Jammu and Kashmir';
  else if (pin >= 201001 && pin <= 285999) return 'Uttar Pradesh';
  else if (pin >= 301001 && pin <= 345999) return 'Rajasthan';
  else if (pin >= 360001 && pin <= 396999) return 'Gujarat';
  else if (pin >= 400001 && pin <= 445999) return 'Maharashtra';
  else if (pin >= 450001 && pin <= 480999) return 'Madhya Pradesh';
  else if (pin >= 481001 && pin <= 497999) return 'Chhattisgarh';
  else if (pin >= 500001 && pin <= 509999) return 'Telangana';
  else if (pin >= 515001 && pin <= 535999) return 'Andhra Pradesh';
  else if (pin >= 560001 && pin <= 591999) return 'Karnataka';
  else if (pin >= 600001 && pin <= 643999) return 'Tamil Nadu';
  else if (pin >= 682001 && pin <= 695999) return 'Kerala';
  else if (pin >= 700001 && pin <= 743999) return 'West Bengal';
  else if (pin >= 751001 && pin <= 770099) return 'Odisha';
  else if (pin >= 800001 && pin <= 813999) return 'Bihar';
  else if (pin >= 814001 && pin <= 835999) return 'Jharkhand';
  return '';
};

for (const addr of testAddresses) {
  const pinMatch = addr.match(/[A-Za-z]?(\d{6})(?:\D|$)/);
  const pincode  = pinMatch?.[1] || '';
  const state    = pincode ? STATE_MAP_BY_PIN(pincode) : '';
  console.log(`Input : ${addr}`);
  console.log(`  → pincode: "${pincode}"  state: "${state}"`);
  console.log();
}
