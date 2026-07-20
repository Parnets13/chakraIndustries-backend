/**
 * normalizeToTallyVoucher.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure function: converts a raw Invoice object into a fully-resolved
 * TallyVoucher sub-document that mirrors Tally's Sales Voucher structure.
 *
 * No DB calls, no network calls — input in, validated sub-document out.
 * Called at write time (bulkUpload, create, update) and by the migration script.
 *
 * Export path then becomes: read stored tallyVoucher → wrap in XML tags → done.
 */

// ─── Unit map ─────────────────────────────────────────────────────────────────
const UNIT_MAP = {
  kg:'Kg', kgs:'Kg', kilogram:'Kg', kilogrames:'Kg',
  liter:'Ltr', litre:'Ltr', ltr:'Ltr', l:'Ltr',
  meter:'Mtr', metre:'Mtr', mtr:'Mtr', m:'Mtr',
  box:'Box', boxes:'Box',
  piece:'Pcs', pieces:'Pcs', pcs:'Pcs', pc:'Pcs',
  nos:'Nos', no:'Nos', number:'Nos', units:'Nos', unit:'Nos',
  pack:'Nos', dozen:'Nos', set:'Nos',
  gm:'Gm', gram:'Gm', grams:'Gm',
  ml:'Ml', milliliter:'Ml',
  ea:'Nos', each:'Nos',
};
const tallyUnit = (u) => UNIT_MAP[(u || '').toLowerCase().trim()] || 'Nos';

// ─── Date helpers ─────────────────────────────────────────────────────────────
/** Format any date value → YYYYMMDD string. Returns null on failure. */
function toTallyDate(d) {
  const dt = d ? new Date(d) : null;
  if (!dt || isNaN(dt.getTime())) return null;
  return `${dt.getFullYear()}${String(dt.getMonth()+1).padStart(2,'0')}${String(dt.getDate()).padStart(2,'0')}`;
}

/** Today as YYYYMMDD, always fresh (not stale if server runs overnight). */
function todayTallyDate() {
  const n = new Date();
  return `${n.getFullYear()}${String(n.getMonth()+1).padStart(2,'0')}${String(n.getDate()).padStart(2,'0')}`;
}

/**
 * Cap voucherDate to periodEnd.
 * Both are YYYYMMDD strings — lexicographic comparison is correct for this format.
 */
function capDate(voucherDate, periodEnd) {
  if (!periodEnd) return voucherDate;
  return voucherDate > periodEnd ? periodEnd : voucherDate;
}

// ─── GST Ledger Resolver ──────────────────────────────────────────────────────
/**
 * Deterministic: given taxType, salesBase, taxAmount, and optional available
 * ledger names fetched from Tally, returns the correct ledger name to use.
 *
 * Precedence:
 *   1. Rate-specific match from availableLedgerNames (e.g. "Output CGST @ 9%")
 *   2. Plain name from availableLedgerNames (e.g. "CGST")
 *   3. Hardcoded fallback plain name
 *
 * @param {'cgst'|'sgst'|'igst'} taxType
 * @param {number} salesBase
 * @param {number} taxAmount
 * @param {string[]|null} availableLedgerNames
 * @returns {string}
 */
export function resolveGstLedgerName(taxType, salesBase, taxAmount, availableLedgerNames) {
  const plain = { cgst: 'CGST', sgst: 'SGST', igst: 'IGST' }[taxType] || 'CGST';
  const outPrefix = taxType === 'igst' ? 'Output IGST' : `Output ${taxType.toUpperCase()}`;

  if (!availableLedgerNames || !availableLedgerNames.length) return plain;

  // Compute effective rate % (half-rate for CGST/SGST, full rate for IGST)
  let rateStr = '';
  if (salesBase > 0 && taxAmount > 0) {
    const rate = +((taxAmount / salesBase) * 100).toFixed(2);
    // Common rate brackets: 2.5, 5, 6, 9, 12, 14, 18, 28
    const brackets = [2.5, 5, 6, 9, 12, 14, 18, 28];
    // Find closest bracket
    const closest = brackets.reduce((best, b) => Math.abs(b - rate) < Math.abs(best - rate) ? b : best, brackets[0]);
    if (Math.abs(closest - rate) < 0.5) rateStr = String(closest);
  }

  // Try rate-specific name first (e.g. "Output CGST @ 9%")
  if (rateStr) {
    const rateSpecific = `${outPrefix} @ ${rateStr}%`;
    if (availableLedgerNames.some(n => n.trim().toLowerCase() === rateSpecific.toLowerCase())) {
      return rateSpecific;
    }
  }

  // Try plain "Output CGST" style (without rate)
  const plainOut = availableLedgerNames.find(n => n.trim().toLowerCase() === outPrefix.toLowerCase());
  if (plainOut) return plainOut;

  // Try bare "CGST"/"SGST"/"IGST"
  const bareMatch = availableLedgerNames.find(n => n.trim().toLowerCase() === plain.toLowerCase());
  if (bareMatch) return bareMatch;

  // Fallback
  return plain;
}

// ─── Main normalizer ──────────────────────────────────────────────────────────
/**
 * Convert a raw Invoice object into a validated TallyVoucher sub-document.
 *
 * @param {Object} invoiceData  - Raw invoice fields (same shape as Invoice mongoose doc)
 * @param {Object} options
 * @param {Object|null} options.tallyGstLedgers  - GST ledger names fetched from Tally: { cgstNames, sgstNames, igstNames } (can be null)
 * @param {string|null} options.periodEnd       - YYYYMMDD period end cap (can be null)
 * @param {string|null} options.companyName     - Tally company name (informational only)
 * @param {string}      options.salesVoucherTypeName - Sales voucher type name in Tally (default: 'Sales')
 * @returns {Object} TallyVoucher sub-document (NOT a Mongoose model instance)
 * @throws {Error} if required fields missing or voucher is imbalanced
 */
export function normalizeToTallyVoucher(invoiceData, options = {}) {
  const { tallyGstLedgers = null, periodEnd = null, salesVoucherTypeName = 'Sales' } = options;

  // ── Required field validation ────────────────────────────────────────────
  const invoiceNo = (invoiceData.invoiceNo || '').toString().trim();
  if (!invoiceNo) throw new Error('normalizeToTallyVoucher: invoiceNo is required');

  const partyLedgerName = (invoiceData.partyName || '').toString().trim();
  if (!partyLedgerName) throw new Error('normalizeToTallyVoucher: partyName is required');

  // ── Date ─────────────────────────────────────────────────────────────────
  const rawDate  = toTallyDate(invoiceData.invoiceDate) || todayTallyDate();
  const voucherDate = capDate(rawDate, periodEnd);

  // ── Amounts ──────────────────────────────────────────────────────────────
  // When items have authoritative per-item totals (from Excel 'Total Value' column),
  // use their sum as the grandTotal. This avoids recomputing from rate×qty and losing
  // the exact values from the source document.
  const itemsWithTotal = (invoiceData.items || []).filter(i => +(i.total || 0) > 0);
  const grandTotal = itemsWithTotal.length > 0
    ? +itemsWithTotal.reduce((s, i) => s + +(i.total || 0), 0).toFixed(2)
    : +((invoiceData.grandTotal || invoiceData.totalAmount || 0)).toFixed(2);
  const storedGrandTotal = +((invoiceData.grandTotal || invoiceData.totalAmount || 0)).toFixed(2);
  // Use whichever is nonzero; prefer the items-based sum when available
  const resolvedGrandTotal = grandTotal > 0 ? grandTotal : storedGrandTotal;
  if (resolvedGrandTotal <= 0) throw new Error(`normalizeToTallyVoucher: grandTotal must be > 0 (got ${resolvedGrandTotal})`);

  const items = invoiceData.items || [];

  // ── GST slab snapping ─────────────────────────────────────────────────────
  const GST_SLABS = [0, 2.5, 5, 6, 9, 12, 14, 18, 28];
  const snapToSlab = (rate) => {
    if (rate <= 0) return 0;
    return GST_SLABS.reduce((best, s) => Math.abs(s - rate) < Math.abs(best - rate) ? s : best, GST_SLABS[0]);
  };

  // ── Determine GST rate ────────────────────────────────────────────────────
  const rawIGST = invoiceData.igstTotal ?? items.reduce((s, i) => s + (+(i.igst || 0)), 0);
  const isInterstate = rawIGST > 0;
  const firstItem = items[0] || {};
  // Prefer item.taxRate (full GST%), else back-calculate from stored tax amounts
  let gstRateFull = snapToSlab(+(firstItem.taxRate || 0));
  if (!gstRateFull) {
    const rawCGSTsum = invoiceData.cgstTotal ?? items.reduce((s, i) => s + (+(i.cgst || 0)), 0);
    const rawSGSTsum = invoiceData.sgstTotal ?? items.reduce((s, i) => s + (+(i.sgst || 0)), 0);
    const rawTax = rawCGSTsum + rawSGSTsum + rawIGST;
    const rawBase = resolvedGrandTotal - rawTax;
    if (rawTax > 0 && rawBase > 0) {
      gstRateFull = snapToSlab(+((rawTax / rawBase) * 100).toFixed(4));
    }
  }
  // Per-duty-head rates (CGST = half of full GST for intrastate)
  const cgstHalfRate = isInterstate ? 0 : snapToSlab(gstRateFull / 2);
  const sgstHalfRate = isInterstate ? 0 : snapToSlab(gstRateFull / 2);
  const igstFullRate = isInterstate ? gstRateFull : 0;

  // ── Valid items & taxable amounts ─────────────────────────────────────────
  // Use qty × rate as the authoritative taxable base per item.
  // CRITICAL: The <RATE> tag in Tally XML is built from itemRate.toFixed(2).
  // The <AMOUNT> tag must equal qty × itemRate rounded the same way.
  // If RATE and AMOUNT differ Tally recomputes tax from RATE and gets a mismatch.
  const validItems = items.filter(item => (item.description || item.name || '').toString().trim());
  const itemAmounts = validItems.map(item => {
    const qty  = +(item.qty  || 1);
    const rate = +(item.rate || 0);
    return +(qty * rate).toFixed(2);
  });

  // ── Compute CGST/SGST/IGST from itemAmounts × rate ────────────────────────
  // Tally's e-invoice engine rounds EACH duty head independently:
  //   CGST = round(itemAmount × cgstRate%) = round(219.05 × 2.5%) = round(5.47625) = 5.48
  //   SGST = round(itemAmount × sgstRate%) = round(219.05 × 2.5%) = round(5.47625) = 5.48
  // Total = 10.96. The taxable base must be set so this is consistent.
  // We derive itemAmounts from qty×rate, and tax from itemAmount × half-rate each.
  let totalCGST = 0, totalSGST = 0, totalIGST = 0;
  for (const amt of itemAmounts) {
    if (igstFullRate > 0) {
      totalIGST = +(totalIGST + +((amt * igstFullRate) / 100).toFixed(2)).toFixed(2);
    } else if (cgstHalfRate > 0) {
      // Round each duty head independently — this is what Tally's e-invoice engine does
      totalCGST = +(totalCGST + +((amt * cgstHalfRate) / 100).toFixed(2)).toFixed(2);
      totalSGST = +(totalSGST + +((amt * sgstHalfRate) / 100).toFixed(2)).toFixed(2);
    }
  }
  const salesBase = +itemAmounts.reduce((s, a) => s + a, 0).toFixed(2);
  const totalTax  = +(totalCGST + totalSGST + totalIGST).toFixed(2);
  const computedGrandTotal = +(salesBase + totalTax).toFixed(2);

  // ── GST ledger names ──────────────────────────────────────────────────────
  const cgstLedger = totalCGST > 0 ? resolveGstLedgerName('cgst', salesBase, totalCGST, tallyGstLedgers?.cgstNames) : '';
  const sgstLedger = totalSGST > 0 ? resolveGstLedgerName('sgst', salesBase, totalSGST, tallyGstLedgers?.sgstNames) : '';
  const igstLedger = totalIGST > 0 ? resolveGstLedgerName('igst', salesBase, totalIGST, tallyGstLedgers?.igstNames) : '';

  // ── Build inventory entries ───────────────────────────────────────────────
  const useInventory = true;

  // Sales credit ledger name for accountingAllocations
  const INVALID_SALES_NAMES = new Set(['sales accounts', 'sales accounts (group)', '']);
  const itemLedgers = validItems
    .map(item => { const r = (item.tallySalesLedger||'').toString().trim(); return INVALID_SALES_NAMES.has(r.toLowerCase()) ? '' : r; })
    .filter(Boolean);
  const uniqueItemLedgers = [...new Set(itemLedgers)];
  const salesCreditLedger = uniqueItemLedgers.length >= 1 ? uniqueItemLedgers[0] : 'Sales';

  const allInventoryEntries = validItems.map((item, i) => {
    const itemName  = (item.description || item.name || '').toString().trim();
    const itemQty   = +(item.qty  || 1);
    const itemRate  = +(item.rate || 0);
    const itemUnit  = tallyUnit(item.unit || 'Nos');
    const itemHSN   = (item.hsn   || '').toString().trim();
    const itemAmount = itemAmounts[i];  // = qty × rate, rounded to 2dp

    // Sales ledger for this item
    const rawLedger = (item.tallySalesLedger || '').toString().trim();
    const GENERIC_LEDGERS = new Set(['', 'sales', 'sales accounts', 'sales accounts (group)']);
    const salesLedger = (!rawLedger || GENERIC_LEDGERS.has(rawLedger.toLowerCase())) ? 'Sales' : rawLedger;

    // GST rate for this item — use invoice-level rate (all items same rate for now)
    const cgstRate = cgstHalfRate;
    const sgstRate = sgstHalfRate;
    const igstRate = igstFullRate;

    return {
      stockItemName: itemName,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      rate:     `${itemRate.toFixed(2)}/${itemUnit}`,
      amount:   itemAmount,   // MUST match RATE tag: qty × rate
      actualQty: `${itemQty} ${itemUnit}`,
      billedQty:  `${itemQty} ${itemUnit}`,
      gstSourceType: '',
      gstLedgerSource: '',   // never set — causes Tally ledger-master rate conflict
      hsnSourceType: '',
      hsnLedgerSource: '',
      gstOverrideTaxability: 'Taxable',
      gstOverrideSupplyType: 'Goods',
      gstHsnName: itemHSN,
      batchAllocations: [{
        godownName: 'Srichakra Industries',
        batchName: 'Primary Batch',
        amount: itemAmount,
        actualQty: `${itemQty} ${itemUnit}`,
        billedQty:  `${itemQty} ${itemUnit}`,
      }],
      // RATEDETAILS: always send explicit rates — Tally uses these for Tax Analysis
      rateDetails: [
                ...(cgstRate > 0 ? [{ gstRateDutyHead: 'CGST', gstRateEvaluationType: 'Based on Value', gstRate: cgstRate.toFixed(2) }] : []),
                ...(sgstRate > 0 ? [{ gstRateDutyHead: 'SGST/UTGST', gstRateEvaluationType: 'Based on Value', gstRate: sgstRate.toFixed(2) }] : []),
                ...(igstRate > 0 ? [{ gstRateDutyHead: 'IGST', gstRateEvaluationType: 'Based on Value', gstRate: igstRate.toFixed(2) }] : []),
              ],
      accountingAllocations: [{
        ledgerName: salesLedger,
        isDeemedPositive: false,
        isLastDeemedPositive: false,
        amount: itemAmount,
      }],
    };
  });

  // ── LEDGERENTRIES tax totals = sum(itemAmount × rate) per item ────────────
  // These are identical to what Tally computes in Tax Analysis → "As per Transaction"
  // matches "As per Calculation" → no warning.
  const ledgerCGST     = totalCGST;
  const ledgerSGST     = totalSGST;
  const ledgerIGST     = totalIGST;
  const reconTotalTax  = totalTax;
  const reconSalesBase = salesBase;
  const reconGrandTotal = computedGrandTotal;
  // ── Ledger entries ────────────────────────────────────────────────────────
  const allLedgerEntries = [];

  // 1. Party ledger (debit) — use reconGrandTotal so party matches inventory+tax
  allLedgerEntries.push({
    ledgerName: partyLedgerName,
    isDeemedPositive: true,
    isLastDeemedPositive: true,
    amount: -reconGrandTotal,    // negative in Tally XML = debit from voucher's perspective
    billAllocations: [{
      name:     invoiceNo,
      billType: 'New Ref',
      amount:   -reconGrandTotal,
    }],
  });

  // 2. CGST — use reconCGST (matches exactly what Tally will recalculate from rateDetails)
  if (ledgerCGST > 0 && cgstLedger) {
    allLedgerEntries.push({
      ledgerName: cgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +ledgerCGST
    });
  }

  // 3. SGST
  if (ledgerSGST > 0 && sgstLedger) {
    allLedgerEntries.push({
      ledgerName: sgstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +ledgerSGST
    });
  }

  // 4. IGST
  if (ledgerIGST > 0 && igstLedger) {
    allLedgerEntries.push({
      ledgerName: igstLedger,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      amount: +ledgerIGST
    });
  }

  // Only add sales credit ledger entry if we're not using inventory entries
    // (inventory entries' ACCOUNTINGALLOCATIONS.LIST will handle the sales credit)
    if (!useInventory) {
      allLedgerEntries.push({
        ledgerName: salesCreditLedger,
        isDeemedPositive: false,
        isLastDeemedPositive: false,
        amount: totalTax > 0 ? +salesBase : +resolvedGrandTotal,
        billAllocations: [],
      });
    }

  // ── Balance check ─────────────────────────────────────────────────────────
  const ledgerSum = +allLedgerEntries.reduce((s, e) => s + e.amount, 0).toFixed(2);
  const inventorySum = useInventory 
    ? +allInventoryEntries.reduce((s, e) => s + (e.amount || 0), 0).toFixed(2)
    : 0;
  const totalSum = (+ledgerSum + +inventorySum).toFixed(2);

  if (Math.abs(+totalSum) > 0.01) {
    throw new Error(
      `normalizeToTallyVoucher: voucher imbalanced by ${totalSum} ` +
      `(invoice ${invoiceNo}, grandTotal=${reconGrandTotal}, cgst=${ledgerCGST}, sgst=${ledgerSGST}, igst=${ledgerIGST}, salesBase=${reconSalesBase})`
    );
  }

  // ── Narration — only include invoice metadata (no item details when inventory is used) ──
  const origDateFmt = invoiceData.invoiceDate
    ? new Date(invoiceData.invoiceDate).toLocaleDateString('en-IN', { day:'2-digit', month:'2-digit', year:'numeric' })
    : '';
  const poRef = (invoiceData.buyersOrderNo || invoiceData.purchaseOrderRef || '').toString().trim();
  
  // Only add item lines to narration when NOT using inventory entries
  const itemLines = useInventory ? [] : validItems.map((item, i) => {
    const itemName   = (item.description || item.name || '').toString().trim();
    const itemQty    = +(item.qty || 1);
    const itemRate   = +(item.rate || 0);
    const itemAmount = itemAmounts[i];
    const itemUnit   = tallyUnit(item.unit || 'Nos');
    // Format: "1. HYDRA STEEL WATER BOTTLE 1000ML: 50 Nos @ ₹150.00 = ₹7,500.00"
    return `${i + 1}. ${itemName}: ${itemQty} ${itemUnit} @ ₹${itemRate.toFixed(2)} = ₹${itemAmount.toFixed(2)}`;
  });
  
  // Send empty narration to ensure e-invoice prints correctly
  const narration = '';

  // ── Assemble sub-document ─────────────────────────────────────────────────
  // ── PO Date → YYYYMMDD ────────────────────────────────────────────────────
  const rawPoDate = invoiceData.poDate || '';
  const poDateTally = rawPoDate ? (toTallyDate(rawPoDate) || '') : '';

  // ── Ship To fields ────────────────────────────────────────────────────────
  const shipToName     = (invoiceData.shipToName    || invoiceData.shipToMailingName || '').toString().trim();
  const shipToAddress  = (invoiceData.shipToAddress || '').toString().trim();
  let   shipToCity     = (invoiceData.shipToCity    || '').toString().trim();
  let   shipToState    = (invoiceData.shipToState   || '').toString().trim();
  const shipToGST      = (invoiceData.shipToGST     || '').toString().trim();
  // Ship-to data must not inherit the bill-to postal code.  Doing so creates a
  // misleading partial consignee block (a name from ship-to plus a pin from the
  // customer) which Tally can silently reject during GST validation.
  let   shipToPincode  = (invoiceData.shipToPincode || '').toString().trim();

  // ── Extract pincode/state from shipToAddress when separate fields are empty ─
  // Raw data from Tally sync often arrives as one concatenated string like:
  // "BASHA FOOTWEARSADUMNEAR POLICE STATION, SADUMAP517123"
  // where state code + pincode are concatenated with no space.
  if (shipToAddress && !shipToPincode) {
    const pinMatch = shipToAddress.match(/[A-Za-z]?(\d{6})(?:\D|$)/);
    if (pinMatch) shipToPincode = pinMatch[1];
  }
  // Derive state from pincode ranges (reliable, no regex ambiguity)
  if (shipToPincode && !shipToState) {
    const pin = parseInt(shipToPincode, 10);
    if      (pin >= 110001 && pin <= 110099) shipToState = 'Delhi';
    else if (pin >= 120001 && pin <= 135999) shipToState = 'Haryana';
    else if (pin >= 140001 && pin <= 160099) shipToState = 'Punjab';
    else if (pin >= 171001 && pin <= 177999) shipToState = 'Himachal Pradesh';
    else if (pin >= 180001 && pin <= 194599) shipToState = 'Jammu and Kashmir';
    else if (pin >= 201001 && pin <= 285999) shipToState = 'Uttar Pradesh';
    else if (pin >= 301001 && pin <= 345999) shipToState = 'Rajasthan';
    else if (pin >= 360001 && pin <= 396999) shipToState = 'Gujarat';
    else if (pin >= 400001 && pin <= 445999) shipToState = 'Maharashtra';
    else if (pin >= 450001 && pin <= 480999) shipToState = 'Madhya Pradesh';
    else if (pin >= 481001 && pin <= 497999) shipToState = 'Chhattisgarh';
    else if (pin >= 500001 && pin <= 509999) shipToState = 'Telangana';
    else if (pin >= 515001 && pin <= 535999) shipToState = 'Andhra Pradesh';
    else if (pin >= 560001 && pin <= 591999) shipToState = 'Karnataka';
    else if (pin >= 600001 && pin <= 643999) shipToState = 'Tamil Nadu';
    else if (pin >= 682001 && pin <= 695999) shipToState = 'Kerala';
    else if (pin >= 700001 && pin <= 743999) shipToState = 'West Bengal';
    else if (pin >= 751001 && pin <= 770099) shipToState = 'Odisha';
    else if (pin >= 800001 && pin <= 813999) shipToState = 'Bihar';
    else if (pin >= 814001 && pin <= 835999) shipToState = 'Jharkhand';
    else if (pin >= 900001 && pin <= 999999) shipToState = 'Assam';
  }

  // ── Bill To fields ────────────────────────────────────────────────────────
  const billToName        = (invoiceData.billToName    || invoiceData.billToMailingName || partyLedgerName).toString().trim();
  const billToMailingName = (invoiceData.billToMailingName || invoiceData.billToName || partyLedgerName).toString().trim();
  const billToAddress     = (invoiceData.billToAddress || invoiceData.partyAddress || '').toString().trim();
  const billToCity        = (invoiceData.billToCity    || invoiceData.partyCity    || '').toString().trim();
  const billToState       = (invoiceData.billToState   || invoiceData.partyState   || '').toString().trim();
  const billToGST         = (invoiceData.billToGST     || invoiceData.partyGST     || '').toString().trim();
  const billToPincode     = (invoiceData.billToPincode || invoiceData.partyPostal || '').toString().trim();

  // ── Party GST / State ────────────────────────────────────────────────────
  const partyGST   = (invoiceData.partyGST || '').toString().trim();
  const rawPartyState = (invoiceData.partyState || billToState || '').toString().trim();

  // Derive party state from GSTIN when not stored — first 2 digits of GSTIN are state code
  const GSTIN_STATE_MAP = {
    '01':'Jammu and Kashmir','02':'Himachal Pradesh','03':'Punjab','04':'Chandigarh',
    '05':'Uttarakhand','06':'Haryana','07':'Delhi','08':'Rajasthan','09':'Uttar Pradesh',
    '10':'Bihar','11':'Sikkim','12':'Arunachal Pradesh','13':'Nagaland','14':'Manipur',
    '15':'Mizoram','16':'Tripura','17':'Meghalaya','18':'Assam','19':'West Bengal',
    '20':'Jharkhand','21':'Odisha','22':'Chhattisgarh','23':'Madhya Pradesh',
    '24':'Gujarat','26':'Dadra and Nagar Haveli and Daman and Diu','27':'Maharashtra',
    '28':'Andhra Pradesh','29':'Karnataka','30':'Goa','31':'Lakshadweep',
    '32':'Kerala','33':'Tamil Nadu','34':'Puducherry','35':'Andaman and Nicobar Islands',
    '36':'Telangana','37':'Andhra Pradesh','38':'Ladakh',
  };
  const gstinForState = partyGST || billToGST || '';
  const derivedState = gstinForState.length >= 2 ? (GSTIN_STATE_MAP[gstinForState.substring(0,2)] || '') : '';
  const partyState = rawPartyState || derivedState;

  // ── Company address ───────────────────────────────────────────────────────
  const companyAddress = (invoiceData.companyAddress || '').toString().trim();

  // ── Godown name — resolved from invoice warehouse field or left blank ─────
  // The serializer in tallyExportService will resolve the final godown name
  // (falling back to warehouseNames[] then "Main Location").
  const godownName = (invoiceData.godownName || invoiceData.warehouse || '').toString().trim();

  // ── E-Invoice fields (IRN, AckNo, AckDate) ───────────────────────────────
  // These are set when the ERP generates an e-invoice via the GST portal.
  // Must be forwarded to Tally so the e-invoice details print on the invoice.
  // IRN must be a valid 64-char hex string; discard anything else (Tally GUIDs etc.)
  const rawIrn = (invoiceData.irn || '').toString().trim();
  const irn = /^[0-9a-fA-F]{64}$/.test(rawIrn) ? rawIrn : '';
  const ackNo = (invoiceData.ackNo || invoiceData.ackno || '').toString().trim();
  // ackDate: store as YYYYMMDD string for Tally XML
  let ackDate = '';
  if (invoiceData.ackDate) {
    const d = new Date(invoiceData.ackDate);
    if (!isNaN(d.getTime())) {
      ackDate = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    }
  }

  return {
    voucherType:      salesVoucherTypeName,   // exact name from Tally's VoucherType list
    voucherNumber:    invoiceNo,
    date:             voucherDate,
    effectiveDate:    voucherDate,
    partyLedgerName,
    isinvoice:        true,
    buyersOrderNo:    (invoiceData.buyersOrderNo || invoiceData.purchaseOrderRef || '').toString().trim(),
    poDate:           poDateTally,
    narration,
    // E-Invoice fields — forwarded to Tally XML so e-invoice prints correctly
    irn,
    ackNo,
    ackDate,
    // Ship To — written as flat top-level tags on the <VOUCHER> element
    shipToName,
    shipToAddress,
    shipToCity,
    shipToState,
    shipToGST,
    shipToPincode,
    // Bill To — written to BASICBUYERADDRESS.LIST (top-level, TYPE="String")
    billToName,
    billToMailingName,
    billToAddress,
    billToCity,
    billToState,
    billToGST,
    billToPincode,
    // Party identification (Step 6)
    partyGST,
    partyState,
    // Company / dispatch address
    companyAddress,
    // Godown — resolved by serializer; blank means serializer picks first warehouse or "Main Location"
    godownName,
    allLedgerEntries,
    allInventoryEntries,
    // Snapshot amounts — stored so export doesn't recompute
    _grandTotal:  reconGrandTotal,
    _totalCGST:   ledgerCGST,
    _totalSGST:   ledgerSGST,
    _totalIGST:   ledgerIGST,
    _salesBase:   reconSalesBase,
    _useInventory: useInventory,
  };
}
