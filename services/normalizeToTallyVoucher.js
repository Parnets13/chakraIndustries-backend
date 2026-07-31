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

  // Compute effective rate % (half-rate for CGST/SGST, full rate for IGST)
  let rateStr = '';
  if (salesBase > 0 && taxAmount > 0) {
    const rate = +((taxAmount / salesBase) * 100).toFixed(2);
    const brackets = [2.5, 5, 6, 9, 12, 14, 18, 28];
    const closest = brackets.reduce((best, b) => Math.abs(b - rate) < Math.abs(best - rate) ? b : best, brackets[0]);
    if (Math.abs(closest - rate) < 0.5) rateStr = String(closest);
  }

  // Use rate-specific ledgers e.g. "Output CGST @ 2.5%"
  // These have TAXTYPE=Others + RATEOFTAXCALCULATION=2.5, which is the
  // correct type for GST output ledgers per Tally docs.
  // The tax amount we send must exactly equal: ROUND(taxableBase × rate / 100, 2)
  // which is what Tally computes — no mismatch.
  if (rateStr) {
    const rateSpecific = `${outPrefix} @ ${rateStr}%`;
    // Check if Tally actually has this ledger
    if (availableLedgerNames && availableLedgerNames.length) {
      const match = availableLedgerNames.find(n => n.trim().toLowerCase() === rateSpecific.toLowerCase());
      if (match) return match;
    }
    // Return the rate-specific name — export creates it with ACTION="Create" if missing
    return rateSpecific;
  }

  // No rate computed — use plain ledger
  if (availableLedgerNames && availableLedgerNames.length) {
    const bareMatch = availableLedgerNames.find(n => n.trim().toLowerCase() === plain.toLowerCase());
    if (bareMatch) return bareMatch;
  }

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

  // ── Determine tax sums — prefer nonzero item-level sum over invoice-level ──
  // BUG FIX: `??` only falls back when the value is null/undefined, not when
  // it is explicitly 0. If invoiceData.cgstTotal === 0 (even though items have
  // real cgst amounts), the fallback never fires and gstRateFull resolves to 0.
  // Fix: always use the item-level sum when it is greater than the invoice-level value.
  const itemCGSTsum = items.reduce((s, i) => s + (+(i.cgst || 0)), 0);
  const itemSGSTsum = items.reduce((s, i) => s + (+(i.sgst || 0)), 0);
  const itemIGSTsum = items.reduce((s, i) => s + (+(i.igst || 0)), 0);
  const rawCGSTsum  = (invoiceData.cgstTotal && invoiceData.cgstTotal > 0) ? invoiceData.cgstTotal : itemCGSTsum;
  const rawSGSTsum  = (invoiceData.sgstTotal && invoiceData.sgstTotal > 0) ? invoiceData.sgstTotal : itemSGSTsum;
  const rawIGST     = (invoiceData.igstTotal && invoiceData.igstTotal > 0) ? invoiceData.igstTotal : itemIGSTsum;
  // ── Determine interstate based on Excel data only ────────────────────────
  // Use IGST amount from Excel — if IGST > 0 then interstate, else intrastate
  // Do NOT auto-detect from state comparison — use exactly what Excel provides
  const isInterstate = rawIGST > 0;

  // ── Invoice-level fallback rate (used only when item has no taxRate) ──────
  const firstItem = items[0] || {};
  let gstRateFull = snapToSlab(+(firstItem.taxRate || 0));
  if (!gstRateFull) {
    const rawTax  = rawCGSTsum + rawSGSTsum + rawIGST;
    const rawBase = resolvedGrandTotal - rawTax;
    if (rawTax > 0 && rawBase > 0) {
      gstRateFull = snapToSlab(+((rawTax / rawBase) * 100).toFixed(4));
    }
  }
  // Invoice-level fallback half-rates (used only when per-item rate is 0)
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

  // ── Compute CGST/SGST/IGST per item using each item's own tax rate ─────────
  // Rate resolution priority per item:
  //   1. item.taxRate (stored from Excel) — most reliable
  //   2. Back-calculate from item's own cgst+sgst amounts vs item amount — catches
  //      invoices where taxRate was never stored but cgst/sgst values are present
  //   3. Invoice-level fallback gstRateFull — last resort
  let totalCGST = 0, totalSGST = 0, totalIGST = 0;
  const itemTaxRates = validItems.map((item, i) => {
    // Interstate only if this specific item has igst > 0 in Excel
    const itemIsInterstate = (+(item.igst || 0)) > 0;
    const itemAmt = itemAmounts[i];

    // Step 1: try item.taxRate directly
    let itemTaxRateFull = snapToSlab(+(item.taxRate || 0));

    // Step 2: if still 0, back-calculate from the item's own cgst/sgst/igst amounts
    if (!itemTaxRateFull) {
      const itemCgst = +(item.cgst || 0);
      const itemSgst = +(item.sgst || 0);
      const itemIgst = +(item.igst || 0);
      const itemTax  = itemCgst + itemSgst + itemIgst;
      const itemBase = +(item.basic || 0) || itemAmt;
      // DIAGNOSTIC — log every item so we can see exactly what values arrive
      console.log(`[normalizeToTallyVoucher] item="${(item.description||item.name||'')}": taxRate=${item.taxRate} cgst=${item.cgst} sgst=${item.sgst} igst=${item.igst} basic=${item.basic} itemAmt=${itemAmt} itemTax=${itemTax} itemBase=${itemBase}`);
      if (itemTax > 0 && itemBase > 0) {
        itemTaxRateFull = snapToSlab(+((itemTax / itemBase) * 100).toFixed(4));
        console.log(`[normalizeToTallyVoucher]  → back-calculated rate: ${itemTaxRateFull}%`);
      }
    }

    // Step 3: fall back to invoice-level rate
    if (!itemTaxRateFull) itemTaxRateFull = gstRateFull;

    return {
      cgst: itemIsInterstate ? 0 : snapToSlab(itemTaxRateFull / 2),
      sgst: itemIsInterstate ? 0 : snapToSlab(itemTaxRateFull / 2),
      igst: itemIsInterstate ? itemTaxRateFull : (isInterstate ? igstFullRate : 0),
    };
  });
  for (let i = 0; i < itemAmounts.length; i++) {
    const item = validItems[i];
    const r    = itemTaxRates[i];
    // ── Use Excel-provided tax amounts directly when available ────────────────
    // Per Tally docs, Tally auto-fills tax amounts from the rate on manual entry.
    // When importing via XML we must send the EXACT same amount Tally would compute
    // OR the exact value from Excel — using the Excel value is most reliable because
    // it is what the business confirmed and avoids recompute rounding differences.
    const excelCGST = +(item.cgst || 0);
    const excelSGST = +(item.sgst || 0);
    const excelIGST = +(item.igst || 0);
    const amt = itemAmounts[i];

    if (r.igst > 0) {
      // Use Excel IGST if available, else compute
      totalIGST = +(totalIGST + (excelIGST > 0 ? excelIGST : +((amt * r.igst) / 100).toFixed(2))).toFixed(2);
    } else if (r.cgst > 0) {
      // Use Excel CGST/SGST if available, else compute
      totalCGST = +(totalCGST + (excelCGST > 0 ? excelCGST : +((amt * r.cgst) / 100).toFixed(2))).toFixed(2);
      totalSGST = +(totalSGST + (excelSGST > 0 ? excelSGST : +((amt * r.sgst) / 100).toFixed(2))).toFixed(2);
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

    // GST rate for this item — use this item's own taxRate, fall back to invoice-level
    const cgstRate = itemTaxRates[i].cgst;
    const sgstRate = itemTaxRates[i].sgst;
    const igstRate = itemTaxRates[i].igst;

    // ── GSTLEDGERSOURCE = sales ledger for this item ─────────────────────────
    // Per BIW20_EXACT_COPY.xml (confirmed working e-invoice), GSTSOURCETYPE=Ledger and
    // GSTLEDGERSOURCE=<sales ledger name> must be present on each inventory entry.
    // Without it Tally's Tax Analysis shows Tax Rate = blank and "As per Transaction = 0",
    // causing the "Tax amount does not match" mismatch shown in screenshot 1.
    // HSNLEDGERSOURCE also uses the same ledger — Tally reads HSN from the ledger master.
    const gstLedgerSource = salesLedger;  // same as accountingAllocations ledger name

    // ── RATEDETAILS: explicit CGST/SGST/IGST rates for this item ────────────
    // Per BIW20_EXACT_COPY.xml lines 293-315, RATEDETAILS.LIST inside
    // ALLINVENTORYENTRIES.LIST carries the component rates (2.5/2.5/5 for 5% GST).
    // Without it Tally cannot populate the Tax rate column in Tax Analysis and
    // "As per Calculation" stays at the correct value while "As per Transaction"
    // stays blank — the mismatch that generates the e-invoice warning.
    // These are informational rates (not override) — Tally reads them for display
    // and cross-check, not to recompute tax from scratch.
    const rateDetails = [];
    if (cgstRate > 0) rateDetails.push({ gstRateDutyHead: 'CGST',      gstRateEvaluationType: 'Based on Value', gstRate: cgstRate });
    if (sgstRate > 0) rateDetails.push({ gstRateDutyHead: 'SGST/UTGST', gstRateEvaluationType: 'Based on Value', gstRate: sgstRate });
    if (igstRate > 0) rateDetails.push({ gstRateDutyHead: 'IGST',       gstRateEvaluationType: 'Based on Value', gstRate: igstRate });
    // Always include Cess + State Cess stubs — present in reference XML, Tally expects them
    rateDetails.push({ gstRateDutyHead: 'Cess',       gstRateEvaluationType: 'Not Applicable', gstRate: 0 });
    rateDetails.push({ gstRateDutyHead: 'State Cess', gstRateEvaluationType: 'Based on Value',  gstRate: 0 });

    return {
      stockItemName: itemName,
      isDeemedPositive: false,
      isLastDeemedPositive: false,
      rate:     `${itemRate.toFixed(2)}/${itemUnit}`,
      amount:   itemAmount,   // MUST match RATE tag: qty × rate
      actualQty: `${itemQty} ${itemUnit}`,
      billedQty:  `${itemQty} ${itemUnit}`,
      // GSTLEDGERSOURCE — required for Tax Analysis to show Tax Rate and "As per Transaction"
      gstSourceType:   'Ledger',
      gstLedgerSource: gstLedgerSource,
      hsnSourceType:   'Ledger',
      hsnLedgerSource: gstLedgerSource,   // same ledger carries both GST rate and HSN
      gstHsnName: itemHSN,
      batchAllocations: [{
        godownName: 'Srichakra Industries',
        batchName: 'Primary Batch',
        amount: itemAmount,
        actualQty: `${itemQty} ${itemUnit}`,
        billedQty:  `${itemQty} ${itemUnit}`,
      }],
      // RATEDETAILS — component rates for Tax Analysis display and e-invoice cross-check
      rateDetails,
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

  // 2. CGST
  // rateOfInvoiceTax: the CGST component rate (half of total GST rate).
  // Derived from totalCGST / salesBase — snapped to the nearest GST slab.
  // VATEXPAMOUNT mirrors AMOUNT exactly; both must be identical per Tally e-invoice validation.
  if (ledgerCGST > 0 && cgstLedger) {
    const cgstComponentRate = salesBase > 0 ? +((ledgerCGST / salesBase) * 100).toFixed(2) : 0;
    const snappedCgstRate   = cgstComponentRate > 0 ? [2.5, 5, 6, 9, 12, 14, 18, 28].reduce(
      (best, s) => Math.abs(s - cgstComponentRate) < Math.abs(best - cgstComponentRate) ? s : best, 0
    ) : 0;
    allLedgerEntries.push({
      ledgerName:         cgstLedger,
      isDeemedPositive:   false,
      isLastDeemedPositive: false,
      amount:             +ledgerCGST,
      rateOfInvoiceTax:   snappedCgstRate,   // e.g. 2.5 for a 5% GST item
      vatExpAmount:       +ledgerCGST,        // must equal amount exactly
    });
  }

  // 3. SGST
  if (ledgerSGST > 0 && sgstLedger) {
    const sgstComponentRate = salesBase > 0 ? +((ledgerSGST / salesBase) * 100).toFixed(2) : 0;
    const snappedSgstRate   = sgstComponentRate > 0 ? [2.5, 5, 6, 9, 12, 14, 18, 28].reduce(
      (best, s) => Math.abs(s - sgstComponentRate) < Math.abs(best - sgstComponentRate) ? s : best, 0
    ) : 0;
    allLedgerEntries.push({
      ledgerName:         sgstLedger,
      isDeemedPositive:   false,
      isLastDeemedPositive: false,
      amount:             +ledgerSGST,
      rateOfInvoiceTax:   snappedSgstRate,   // same as CGST component rate
      vatExpAmount:       +ledgerSGST,
    });
  }

  // 4. IGST
  if (ledgerIGST > 0 && igstLedger) {
    const igstComponentRate = salesBase > 0 ? +((ledgerIGST / salesBase) * 100).toFixed(2) : 0;
    const snappedIgstRate   = igstComponentRate > 0 ? [5, 12, 18, 28].reduce(
      (best, s) => Math.abs(s - igstComponentRate) < Math.abs(best - igstComponentRate) ? s : best, 0
    ) : 0;
    allLedgerEntries.push({
      ledgerName:         igstLedger,
      isDeemedPositive:   false,
      isLastDeemedPositive: false,
      amount:             +ledgerIGST,
      rateOfInvoiceTax:   snappedIgstRate,   // full GST rate e.g. 18
      vatExpAmount:       +ledgerIGST,
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

  // ── shipToState resolution — strict priority order ────────────────────────
  // 1. Explicitly stored shipToState (set by Excel column "Ship To State")
  // 2. Derived from ship-to pincode (most reliable for cross-state deliveries)
  // 3. Keyword scan of shipToAddress / shipToCity text
  // 4. Final fallback: bill-to / party state (only when genuinely same address)
  //
  // IMPORTANT: Do NOT fall back to partyState/billToState at step 1.
  // That caused Karnataka (bill-to state) to leak into ship-to state for
  // out-of-state consignees, producing wrong Place of Supply on the invoice.
  let shipToState = (invoiceData.shipToState || '').toString().trim();

  const rawShipToGST   = (invoiceData.shipToGST     || '').toString().trim();
  // Only store a valid 15-char GST number — reject dots, dashes, N/A, empty-like values
  const shipToGST      = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(rawShipToGST) ? rawShipToGST : '';
  // Ship-to data must not inherit the bill-to postal code.  Doing so creates a
  // misleading partial consignee block (a name from ship-to plus a pin from the
  // customer) which Tally can silently reject during GST validation.
  let   shipToPincode  = (invoiceData.shipToPincode || '').toString().trim();

  // ── Extract pincode from shipToAddress if not stored separately ──────────
  if (shipToAddress && !shipToPincode) {
    // Match 6-digit number anywhere in the address, optionally preceded by letters
    const pinMatch = shipToAddress.match(/(?<![0-9])(\d{6})(?![0-9])/);
    if (pinMatch) shipToPincode = pinMatch[1];
  }

  // ── Derive state from pincode — runs even if shipToState is blank ─────────
  // (pincode-based derivation is more reliable than text keywords or bill-to fallback)
  if (shipToPincode && !shipToState) {
    const pin = parseInt(shipToPincode, 10);
    if      (pin >= 110001 && pin <= 110999) shipToState = 'Delhi';
    else if (pin >= 120001 && pin <= 135999) shipToState = 'Haryana';
    else if (pin >= 140001 && pin <= 160099) shipToState = 'Punjab';
    else if (pin >= 160101 && pin <= 160163) shipToState = 'Chandigarh';
    else if (pin >= 171001 && pin <= 177999) shipToState = 'Himachal Pradesh';
    else if (pin >= 180001 && pin <= 194599) shipToState = 'Jammu and Kashmir';
    else if (pin >= 201001 && pin <= 244999) shipToState = 'Uttar Pradesh';
    else if (pin >= 245001 && pin <= 249999) shipToState = 'Uttarakhand';
    else if (pin >= 250001 && pin <= 285999) shipToState = 'Uttar Pradesh';
    else if (pin >= 301001 && pin <= 345999) shipToState = 'Rajasthan';
    else if (pin >= 360001 && pin <= 396999) shipToState = 'Gujarat';
    else if (pin >= 400001 && pin <= 445999) shipToState = 'Maharashtra';
    else if (pin >= 450001 && pin <= 480999) shipToState = 'Madhya Pradesh';
    else if (pin >= 481001 && pin <= 497999) shipToState = 'Chhattisgarh';
    else if (pin >= 500001 && pin <= 514999) shipToState = 'Telangana';
    else if (pin >= 515001 && pin <= 535999) shipToState = 'Andhra Pradesh';
    else if (pin >= 560001 && pin <= 591999) shipToState = 'Karnataka';
    else if (pin >= 600001 && pin <= 643999) shipToState = 'Tamil Nadu';
    else if (pin >= 670001 && pin <= 695999) shipToState = 'Kerala';
    else if (pin >= 700001 && pin <= 743999) shipToState = 'West Bengal';
    else if (pin >= 751001 && pin <= 770099) shipToState = 'Odisha';
    else if (pin >= 781001 && pin <= 788999) shipToState = 'Assam';
    else if (pin >= 790001 && pin <= 792999) shipToState = 'Arunachal Pradesh';
    else if (pin >= 793001 && pin <= 794999) shipToState = 'Meghalaya';
    else if (pin >= 795001 && pin <= 795150) shipToState = 'Manipur';
    else if (pin >= 796001 && pin <= 796901) shipToState = 'Mizoram';
    else if (pin >= 797001 && pin <= 798627) shipToState = 'Nagaland';
    else if (pin >= 799001 && pin <= 799290) shipToState = 'Tripura';
    else if (pin >= 737101 && pin <= 737139) shipToState = 'Sikkim';
    else if (pin >= 800001 && pin <= 813999) shipToState = 'Bihar';
    else if (pin >= 814001 && pin <= 835999) shipToState = 'Jharkhand';
    else if (pin >= 836001 && pin <= 855999) shipToState = 'Bihar';
  }

  // ── Keyword scan of address text (if pincode derivation didn't work) ──────
  if (!shipToState && (shipToAddress || shipToCity)) {
    const text = `${shipToAddress} ${shipToCity}`.toLowerCase();
    const stateKeywords = [
      ['gorakhpur', 'Uttar Pradesh'], ['lucknow', 'Uttar Pradesh'], ['noida', 'Uttar Pradesh'],
      ['agra', 'Uttar Pradesh'], ['kanpur', 'Uttar Pradesh'], ['varanasi', 'Uttar Pradesh'],
      ['mumbai', 'Maharashtra'], ['pune', 'Maharashtra'], ['nagpur', 'Maharashtra'],
      ['delhi', 'Delhi'], ['new delhi', 'Delhi'], ['bengaluru', 'Karnataka'],
      ['bangalore', 'Karnataka'], ['mysore', 'Karnataka'], ['hubli', 'Karnataka'],
      ['chennai', 'Tamil Nadu'], ['coimbatore', 'Tamil Nadu'], ['madurai', 'Tamil Nadu'],
      ['hyderabad', 'Telangana'], ['warangal', 'Telangana'],
      ['kolkata', 'West Bengal'], ['howrah', 'West Bengal'],
      ['ahmedabad', 'Gujarat'], ['surat', 'Gujarat'], ['vadodara', 'Gujarat'],
      ['jaipur', 'Rajasthan'], ['jodhpur', 'Rajasthan'], ['udaipur', 'Rajasthan'],
      ['bhopal', 'Madhya Pradesh'], ['indore', 'Madhya Pradesh'], ['gwalior', 'Madhya Pradesh'],
      ['patna', 'Bihar'], ['gaya', 'Bihar'],
      ['ranchi', 'Jharkhand'], ['jamshedpur', 'Jharkhand'],
      ['raipur', 'Chhattisgarh'], ['bilaspur', 'Chhattisgarh'],
      ['bhubaneswar', 'Odisha'], ['cuttack', 'Odisha'],
      ['guwahati', 'Assam'],
      ['kochi', 'Kerala'], ['thiruvananthapuram', 'Kerala'], ['kozhikode', 'Kerala'],
      ['visakhapatnam', 'Andhra Pradesh'], ['vijayawada', 'Andhra Pradesh'],
      ['chandigarh', 'Chandigarh'],
      ['dehradun', 'Uttarakhand'],
      ['shimla', 'Himachal Pradesh'],
      ['amritsar', 'Punjab'], ['ludhiana', 'Punjab'],
      ['gurgaon', 'Haryana'], ['faridabad', 'Haryana'], ['gurugram', 'Haryana'],
    ];
    for (const [kw, state] of stateKeywords) {
      if (text.includes(kw)) { shipToState = state; break; }
    }
  }

  // ── Final fallback: use bill-to state ONLY when ship-to name = bill-to name ─
  // i.e. consignee and buyer are genuinely the same party
  if (!shipToState) {
    const sameParty = !shipToName || shipToName.toLowerCase() === (invoiceData.billToName || invoiceData.partyName || '').toString().toLowerCase();
    if (sameParty) {
      shipToState = (invoiceData.partyState || invoiceData.billToState || '').toString().trim();
    }
  }

  // ── Bill To fields ────────────────────────────────────────────────────────
  const billToName        = (invoiceData.billToName    || invoiceData.billToMailingName || partyLedgerName).toString().trim();
  const billToMailingName = (invoiceData.billToMailingName || invoiceData.billToName || partyLedgerName).toString().trim();
  const billToAddress     = (invoiceData.billToAddress || invoiceData.partyAddress || '').toString().trim();
  const billToCity        = (invoiceData.billToCity    || invoiceData.partyCity    || '').toString().trim();
  const billToState       = (invoiceData.billToState   || invoiceData.partyState   || '').toString().trim();
  const billToGST         = (invoiceData.billToGST     || invoiceData.partyGST     || '').toString().trim();

  // ── billToPincode: use stored value, or extract from address if missing ───
  // Old invoices uploaded before the frontend fix won't have billToPincode stored.
  // Extract the 6-digit pincode from the address string as fallback.
  let billToPincode = (invoiceData.billToPincode || invoiceData.partyPostal || '').toString().trim();
  if (!billToPincode && billToAddress) {
    const pinMatch = billToAddress.match(/\b(\d{6})\b/);
    if (pinMatch) billToPincode = pinMatch[1];
  }

  // ── Party GST / State (Step 6 fields) ────────────────────────────────────
  const partyGST      = (invoiceData.partyGST   || '').toString().trim();
  const partyState    = (invoiceData.partyState  || billToState || '').toString().trim();

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
