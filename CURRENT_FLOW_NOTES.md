# CURRENT FLOW NOTES — Excel → Tally
### Sri Chakra Industries ERP | `d:\chakraproject\chakraIndustries-backend`
### Date: October 2026 | Status: Production

---

## 1. STEP-BY-STEP FLOW DIAGRAM

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Excel Upload (Frontend)                                            │
│  File: src/pages/finance/InvoiceGeneratorPage.jsx                          │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          │  User selects Excel file (GRT Invoice format or Orders format)
          │  Library: xlsx (XLSX.read → sheet_to_json)
          │
          ▼
  parseGRTExcel(rows)  ← InvoiceGeneratorPage.jsx ~line 650
    Reads these columns from Excel per item row:
      "Item Name"       → item.description
      "HSN"             → item.hsn         ← HSN COMES FROM EXCEL COLUMN
      "Qty"             → item.qty
      "Unit Rate"       → item.rate
      "Basic"           → item.basic
      "cgst"            → item.cgst
      "sgst"            → item.sgst
      "igst"            → item.igst
      "Total Value"     → item.total
      "Sales Ledger"    → item.tallySalesLedger
    Reads these per invoice group:
      "Invoice No"      → invoiceNo
      "Bill To"         → partyName / billToName
      "GSTIN"           → partyGST / billToGST
      "PO NO"           → purchaseOrderRef
      "Ship To Name"    → shipToName
      "Bill To State"   → billToState
          │
          │  Result: Array of parsed invoice objects
          │  POST to: /api/invoices/bulk-upload
          ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Backend Bulk Upload                                                │
│  File: controllers/invoiceController.js → bulkUpload()                     │
│  Route: POST /api/invoices/bulk-upload                                      │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ├─ A. Collect all unique item names from all rows
          │
          ├─ B. Single DB query:
          │      ItemMaster.find({ name: { $in: allItemNames } },
          │                       'name hsn tallySalesLedger')
          │      → itemMasterMap (Map<name, {hsn, tallySalesLedger}>)
          │
          ├─ C. Auto-create new ItemMaster entries for unknown items
          │      (upsert by name, seeds tallySalesLedger if Excel has valid value)
          │
          ├─ D. Eager backfill: update ItemMaster.tallySalesLedger for
          │      existing items whose ledger field is blank
          │
          ├─ E. Per-invoice enrichment — HSN merge:
          │      const enrichedItems = items.map(item => ({
          │        ...item,
          │        hsn: (item.hsn || '').trim()     ← Excel first
          │             || (im?.hsn || '').trim(),  ← ItemMaster fallback
          │        tallySalesLedger: sanitiseSalesLedger(item.tallySalesLedger)
          │                       || sanitiseSalesLedger(im?.tallySalesLedger),
          │      }))
          │      [invoiceController.js ~line 430]
          │
          ├─ F. normalizeToTallyVoucher(invoiceData, { periodEnd })
          │      → builds tallyVoucher sub-document and stores in DB
          │
          └─ G. Invoice.insertMany(docs)
                Also archives to StockInvoiceArchive
          │
          ▼  Invoice saved in MongoDB with:
             invoices collection: { invoiceNo, partyName, items[{description, hsn, ...}],
                                    tallyVoucher: {...}, tallySync: false }

┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: Tally Export Trigger (Manual from UI)                              │
│  File: controllers/tallyController.js → exportToTallyStream()              │
│  Route: GET /api/tally/export-stream?type=sales&token=<jwt>                │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          │  Calls: exportSalesInvoices(cfg, triggeredBy)
          │  File: services/tallyExportService.js
          ▼

┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: exportSalesInvoices() — Pre-flight Steps                          │
│  File: services/tallyExportService.js                                       │
└─────────────────────────────────────────────────────────────────────────────┘

  Step 0:  Ping Tally → detect company name
           Function: parseOpenCompanyListResponse()
           Guard: abort if company name mismatch

  Step 0.6: Probe Tally voucher types → find exact Sales voucher type name
            Prevents "Voucher type not found" EXCEPTIONS

  Step 1:  fetchTallyGstLedgerNames(cfg) — in direct mode only
           Returns: { cgstNames[], sgstNames[], igstNames[] }
           Used to pick correct "CGST" / "Output CGST @ 9%" ledger name

  Step 2:  fetchTallySalesLedgerNames(cfg)
           Returns: array of Tally Sales Account ledger names
           BONUS: also fetches HSNCODE from each sales ledger → ledgerHsnMap
           (This is fallback source 3 for HSN)

  Step 3:  Invoice.find({ tallySync:{$ne:true}, retryCount:{$lte:4}, ... })
           → invoices array

  Step 4:  Fetch Tally godown names

  Step 5:  Fetch stock item GST rates from Tally (StockGSTCheck collection)
           → tallyStockGstMap (to decide Create vs Alter per stock item)
           Note: fetches only GSTRate, NOT HSNCode

  Step 5b: fetchTallyStockItemHsnAndType(cfg)  [NEWLY ADDED]
           → tallyStockHsnTypeMap (Name → {hsn, typeOfSupply})
           Used for HSN validation and auto-fix

  Step 6:  Build autoStockXml (stock item masters to create/alter in Tally)
           HSN source: stockHsnMap.get(name) from ItemMaster.hsn

  Step 7:  fetchTallyExistingVoucherNumbers(cfg) → dedup map
           fetchTallyPOMap(cfg) → PO number → GUID map
           fetchTallyMastersForValidation(cfg) → godowns, ledgers
           fetchTallyPeriodEnd(cfg) → cap voucher dates

  Step 8:  Per-invoice loop (lines ~2580–2825)

┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: Per-Invoice Processing Loop                                        │
│  File: services/tallyExportService.js ~line 2580                           │
└─────────────────────────────────────────────────────────────────────────────┘

  For each invoice:
    │
    ├─ SAFEGUARD 1: validateInvoiceForExport(inv)
    │    Checks: invoiceNo not blank, partyName not blank, grandTotal > 0
    │    Fail → push to failedItems, increment retryCount, skip
    │
    ├─ SAFEGUARD HSN: Per-item HSN validation [NEWLY ADDED]
    │    For each item → tallyStockHsnTypeMap.get(itemName.toLowerCase())
    │    → validateItemHsnAndType(itemName, tallyMaster, erpMaster)
    │      Case A: item not in Tally yet → valid: true (will be created)
    │      Case B: Tally HSN blank, ERP has HSN → valid:true, needsUpdate:true
    │              → stockItemsToUpdate.set(name, {hsn, expectedType})
    │      Case C: Tally HSN blank AND ERP blank → BLOCK (retryCount NOT incremented)
    │      Case D: HSN exists, typeOfSupply mismatch → BLOCK
    │
    ├─ SAFEGUARD 2: Invoice number dedup check
    │    tallyVoucherNumbers.get("salestype|INVOICENO")
    │    If exists → ACTION="Alter", else ACTION="Create"
    │
    ├─ enrichedItems loop — PER-EXPORT FRESH MERGE:
    │    For each item in inv.items:
    │      const im = masterMap.get(itemName)
    │      hsn = (item.hsn || '').trim()          ← Source 1: invoice.items.hsn
    │            || (im?.hsn || '').trim()         ← Source 2: ItemMaster.hsn
    │      // If still blank:
    │      if (!hsn && tallySalesLedger)
    │        hsn = ledgerHsnMap.get(tallySalesLedger.toLowerCase())  ← Source 3
    │        // Also persists back to ItemMaster
    │    [tallyExportService.js ~line 2693–2740]
    │
    ├─ normalizeToTallyVoucher({ ...inv, items: enrichedItems }, options)
    │    → line 289: const itemHSN = (item.hsn || '').toString().trim()
    │    → written as gstHsnName in allInventoryEntries
    │    → maps to <GSTHSNNAME> in Tally XML
    │
    └─ serializeTallyVoucher(tv, cfg, action, guidTag)
         Builds final <VOUCHER> XML
         <GSTOVRDNTYPEOFSUPPLY>${itemTypeOfSupply}</GSTOVRDNTYPEOFSUPPLY>
           (Goods if HSN not starting with 99, Services if starts with 99)

┌─────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: Pre-Batch Fix + Send to Tally                                      │
│  File: services/tallyExportService.js                                       │
└─────────────────────────────────────────────────────────────────────────────┘

  Pre-step: If stockItemsToUpdate.size > 0:
    → Send ACTION="Alter" batch to Tally with correct HSNCODE + GSTTYPEOFSUPPLY
    → parseResponse (log only, don't abort)
    → [NEWLY ADDED — auto-fixes blank HSN in Tally master before voucher send]

  Batch send: 10 vouchers per batch → importEnvelope(cfg, 'Vouchers', xml)
    → postXml(cfg, envelope, 60000)
    → Tally returns CREATED/ALTERED/EXCEPTIONS count
    → On EXCEPTIONS: re-send each voucher solo to extract LINEERROR

  On success:
    Invoice.updateMany({ tallySync: true, retryCount: 0, lastError: "" })

  On fail:
    Invoice.findByIdAndUpdate({ $inc: { retryCount: 1 }, lastError: "..." })
    EXCEPTION: "HSN missing in both Tally and ERP" → retryCount NOT incremented

---

## 2. HSN KAHA SE AATA HAI? (Complete Chain)

```
Priority 1 (Highest): Excel Column "HSN"
  → parseGRTExcel reads it directly
  → stored as Invoice.items[].hsn
  File: InvoiceGeneratorPage.jsx ~line 720
  Column names recognized: "HSN", "HSN Code", "HSN/SAC"

Priority 2: ItemMaster.hsn (MongoDB fallback)
  → Merged at upload time in bulkUpload():
     (item.hsn || '').trim() || (im?.hsn || '').trim()
  File: invoiceController.js ~line 430
  → Also merged at export time in enrichedItems loop:
     let hsn = (item.hsn || '').trim() || (im?.hsn || '').trim()
  File: tallyExportService.js ~line 2700

Priority 3 (Lowest): Tally Sales Ledger HSNCODE (live fetch)
  → fetchTallySalesLedgerNames() returns hsnByLedger Map
  → Used ONLY when Priority 1 and 2 are both blank
  → If found, persists back to ItemMaster.hsn automatically
  File: tallyExportService.js ~line 2725–2732

Priority 4: NEWLY ADDED — stockItemsToUpdate auto-fix
  → If Tally master has blank HSN but ERP has HSN
  → Sends ACTION="Alter" to Tally to fill HSN before voucher
  File: tallyExportService.js (Pre-step before batch send)
```

### Agar teeno jagah blank hai to kya hota hai?

```
Excel HSN = blank
  +
ItemMaster.hsn = blank
  +
Tally Sales Ledger has no HSNCODE
  +
Tally Stock Item master has no HSNCODE
  ↓
Result: Invoice BLOCKED with error:
  "HSN missing in both Tally and ERP for Item: <name> - Please fill HSN in ItemMaster"
  
retryCount: NOT incremented (so user can fix and retry)
failedItems: Invoice appears in UI "Not Exported" panel
```

### HSN ka XML mein kya hota hai?

```
Tally XML mein 3 jagah HSN jata hai:

1. Stock Item Master:
   <HSNCODE>${esc(hsn)}</HSNCODE>
   Source: stockHsnMap (from ItemMaster.hsn)
   File: tallyExportService.js ~line 2444

2. Inventory Entry (per item):
   <GSTHSNNAME>${esc(gstHsnName)}</GSTHSNNAME>
   Source: itemHSN from normalizeToTallyVoucher line 289
   File: normalizeToTallyVoucher.js ~line 383

3. HSNLEDGERSOURCE (reads HSN from Tally sales ledger):
   <HSNLEDGERSOURCE>${esc(hsnLedgerSrc)}</HSNLEDGERSOURCE>
   Source: tallySalesLedger name (indirect — Tally reads the ledger)
   File: tallyExportService.js (serializeTallyVoucher) ~line 1466
```

---

## 3. CURRENT DATA STATUS

### ItemMaster Collection
- **Field name**: `hsn` (String, default `''`)
- **Collection name**: `itemmasters`
- **Diagnostic endpoint**: `GET /api/tally/hsn-full-report`

Estimated status based on recent session:
| Metric | Value |
|--------|-------|
| Total ItemMasters | ~500+ |
| Items WITH HSN | ~3–10 (very few) |
| Items WITHOUT HSN | ~490+ (majority) |
| HSN fill rate | ~1–2% |

**4 items recently fixed via API:**
| Item | HSN |
|------|-----|
| Bajaj ICX 160TS Neo Induction Stove | 85166000 |
| LIV-ENVY-WAAS | 84212190 |
| Orient 16" Stand/Pedestal Fan (regex) | 84145930 |
| Envy Alkaline RO (regex) | 84212190 |

### Invoices Collection
- **Pending export** (`tallySync: false`): ~95 invoices (after last upload of 98)
- **Successfully exported**: 3 invoices (only those with HSN in all items)
- **Why pending**: Previously blocked because Tally master had blank HSN; now auto-fix logic handles it

### How retryCount works
```
retryCount starts at 0 on upload
On every export fail: $inc retryCount by 1
MAX_RETRIES = 4 (constant in tallyExportService.js line 24)
When retryCount > 4: invoice permanently excluded from export queue
EXCEPTION: "HSN missing in both Tally and ERP" → retryCount NOT incremented

Reset via: POST /api/tally/reset-invoice-sync
Or MongoDB: db.invoices.updateMany({tallySync:{$ne:true}}, {$set:{retryCount:0}})
```

---

## 4. PROBLEMS JO DIKH RAHE HAIN

### Problem 1: ItemMaster.hsn mostly blank — CRITICAL
**Root Cause**: Jab Tally se items import hote hain (`dataSource: 'Tally'`), unka HSN Tally se import nahi hota. `tallyFetchEngine.js` mein stock item import karta hai `GSTApplicable` aur `GSTRate` toh fetch karta hai par `HSNCode` fetch nahi karta tha pehle.

**Impact**: 98 invoices upload ki → 95 block ho gayi sirf is wajah se.

**Fix Status**: Auto-fix logic add ki gayi hai:
- Export time pe: Tally master blank + ERP has HSN → auto `ACTION="Alter"` patch
- User fill kar sake: `POST /api/itemmasters/bulk-hsn` endpoint available

---

### Problem 2: GSTTYPEOFSUPPLY hardcoded to "Goods" — FIXED
**Root Cause**: Every stock item aur every inventory entry mein `<GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>` hardcoded tha. Service items (HSN starting with 99) ke liye yeh wrong tha.

**Fix Status**: Now dynamic — `hsn.startsWith('99') ? 'Services' : 'Goods'`
- File: `tallyExportService.js` (stock item XML ~line 2442)
- File: `tallyExportService.js` (serializeTallyVoucher ~line 1449)

---

### Problem 3: No HSN Dictionary / Validation at upload time
**Root Cause**: Jab Excel upload hota hai, HSN column mein jo value hai woh blindly accept ho jaati hai. Koi validation nahi hai ki:
- HSN actually valid hai ya nahi (4–8 digit numeric?)
- HSN item category se match karta hai ya nahi

**Impact**: Wrong HSN from Excel silently saves in DB → e-invoice fail hoga.

**Fix Status**: Partial — bulk-hsn endpoint HSN format validate karta hai (`/^\d{4,8}$/`). But upload time pe per-item HSN format validation nahi hai.

---

### Problem 4: Excel "Sales Ledger" column garbage values
**Root Cause**: GRT Excel mein "Sales Ledger" column mein kabhi kabhi customer names ya product names aa jaati hain instead of actual Tally ledger names. Old code yeh directly ItemMaster mein save kar deta tha.

**Fix Status**: `isSafeSalesLedger()` + `sanitiseSalesLedger()` guards add hain in `bulkUpload`. Only values containing "sales" (case-insensitive) are accepted.

---

### Problem 5: Tally Sales Ledger missing for items — "Tax amount does not match"
**Root Cause**: Har item ka ek specific Tally Sales Ledger hona chahiye (e.g. "SS Bottle Sales Local 5%"). Agar yeh blank hai toh Tally Tax Analysis mein "As per Transaction = blank" aata hai → e-invoice warning.

**Fix Status**: Auto-resolve logic in `exportSalesInvoices` tries to match from live Tally ledger list using `resolveSalesLedger()` and saves back to ItemMaster. But auto-resolve kabhi kabhi wrong ledger match kar leta hai.

---

### Problem 6: StockGSTCheck query HSN nahi fetch karta
**Root Cause**: Existing `StockGSTCheck` TDL Collection query only fetches `Name, GSTApplicable, GSTRate` — not `HSNCode`. So the system never had visibility into what HSN Tally already has.

**Fix Status**: `fetchTallyStockItemHsnAndType()` function add ki gayi (NEW) which separately fetches `Name, HSNCode, GSTTypeOfSupply` from Tally.

---

### Problem 7: Excel se directly HSN nahi aata zyada tar
**Observation**: GRT format mein "HSN" column hota hai par practice mein mostly blank rahta hai ya wrong value hoti hai. Most Excel files don't have accurate HSN.

**Impact**: ItemMaster bhi blank hai → 3-level fallback chain bhi fail → invoice blocked.

**Fix Required**: Customer Excel template mein HSN column mandatory banana, ya bulk fill karna via `POST /api/itemmasters/bulk-hsn` endpoint.

---

## 5. CODE REFERENCES SUMMARY

| Component | File | Key Lines | Purpose |
|-----------|------|-----------|---------|
| Excel parsing (GRT format) | `src/pages/finance/InvoiceGeneratorPage.jsx` | ~620–800 | `parseGRTExcel()` — column mapping |
| HSN column read from Excel | `InvoiceGeneratorPage.jsx` | ~720 | `'HSN'/'HSN Code'/'HSN/SAC'` |
| Sales Ledger column read | `InvoiceGeneratorPage.jsx` | ~730 | `'Sales Ledger'/'Tally Sales Ledger'` |
| POST to backend | `InvoiceGeneratorPage.jsx` | ~850 | `invoiceApi.bulkUpload({invoices})` |
| Bulk upload handler | `controllers/invoiceController.js` | `bulkUpload` | Entry point for all Excel uploads |
| ItemMaster pre-fetch | `invoiceController.js` | ~350 | `ItemMaster.find({name:{$in:...}})` |
| HSN merge at upload | `invoiceController.js` | ~430 | `item.hsn || im?.hsn` |
| tallySalesLedger guard | `invoiceController.js` | ~370 | `isSafeSalesLedger()` |
| Invoice schema | `models/Invoice.js` | ~95–120 | `invoiceItemSchema` — hsn field |
| TallyVoucher schema | `models/Invoice.js` | ~40–90 | `inventoryEntrySchema` — gstHsnName |
| ItemMaster schema | `models/ItemMaster.js` | ~87–91 | `hsn: {type: String, default:''}` |
| itemHSN in normalize | `services/normalizeToTallyVoucher.js` | 289 | `const itemHSN = (item.hsn||'').trim()` |
| gstHsnName set | `normalizeToTallyVoucher.js` | 383 | `gstHsnName: itemHSN` |
| Export main function | `services/tallyExportService.js` | `exportSalesInvoices` | Full pipeline |
| HSN fetch from Tally | `tallyExportService.js` | `fetchTallyStockItemHsnAndType` | NEW function |
| HSN validate | `tallyExportService.js` | `validateItemHsnAndType` | NEW function |
| enrichedItems HSN merge | `tallyExportService.js` | ~2700 | 3-level HSN resolution |
| ledgerHsnMap source 3 | `tallyExportService.js` | ~2725 | Fallback from Tally ledger |
| Auto-fix HSN in Tally | `tallyExportService.js` | Pre-batch step | `stockItemsToUpdate` → Alter XML |
| Stock item XML | `tallyExportService.js` | ~2444 | `<HSNCODE>`, `<GSTTYPEOFSUPPLY>` |
| Voucher XML (GSTHSNNAME) | `tallyExportService.js` | `serializeTallyVoucher` ~1449 | `<GSTHSNNAME>` in inventory entry |
| retryCount increment | `tallyExportService.js` | ~3117 | HSN-both-blank = no increment |
| MAX_RETRIES constant | `tallyExportService.js` | Line 24 | `const MAX_RETRIES = 4` |
| Bulk HSN update API | `controllers/itemMasterController.js` | `bulkUpdateHsn` | `POST /api/itemmasters/bulk-hsn` |
| HSN diagnostic endpoint | `routes/tallyRoutes.js` | `/hsn-full-report` | Full status report |
| Export SSE route | `routes/tallyRoutes.js` | `/export-stream` | Trigger export from UI |

---

## 6. COMPARISON: MARKET SOFTWARE vs THIS ERP

| Feature | Market ERP (e.g. Zoho, SAP B1) | This ERP (Current State) |
|---------|-------------------------------|--------------------------|
| HSN at upload | Required field, validated | Optional, blank accepted |
| HSN source of truth | Item Master (mandatory) | Excel col → ItemMaster fallback |
| ItemMaster HSN fill rate | ~100% | ~1–2% |
| Tally sync architecture | API/ODBC, bidirectional | Custom XML over HTTP, push-only |
| e-Invoice validation before send | Yes, inline | Partial (HSN+Type check added) |
| GST ledger mapping | Auto by GST rate | Manual per item (tallySalesLedger) |
| Voucher type per company | Auto-detect | Yes (PING_XML + VoucherType probe) |
| Duplicate prevention | DB + ERP check | Tally live query + retryCount |
| Error visibility | Per-field inline | Per-invoice in "Not Exported" panel |
| Bulk fill HSN | Excel import in Item Master | `POST /api/itemmasters/bulk-hsn` ✅ |

---

## 7. RECOMMENDED NEXT STEPS

### Immediate (karo abhi)
1. **Fill remaining ~497 ItemMaster HSN codes** via `POST /api/itemmasters/bulk-hsn`
   — Prepare Excel: Item Name | HSN columns → convert to JSON array → POST
2. **Re-run Tally Export** — sab 98 invoices should now go through

### Short-term (is sprint mein)
3. **Add HSN validation at Excel upload time** — before saving, check each item's HSN is 4–8 digits numeric. Show warning if blank.
4. **Make ItemMaster.hsn required** for active items — add mongoose validator or at least UI-level enforcement in Item Master form.

### Long-term
5. **Import HSN from Tally** — extend `tallyFetchEngine.js` stock item import to also pull `HSNCode` into `ItemMaster.hsn`. Currently only `GSTRate` is pulled.
6. **HSN master dictionary** — Add a static `hsnDictionary.js` with common HSN codes for electrical/appliance categories. Used to auto-suggest HSN when creating new items.
