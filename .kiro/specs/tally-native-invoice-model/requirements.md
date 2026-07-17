# Requirements Document

## Introduction

This feature redesigns the invoice data architecture so that invoices are stored in a Tally-native Sales Voucher structure from the moment they are created — whether via Excel upload or manual entry. Instead of persisting a custom ERP format and running a field-mapping function at export time, the system stores the exact fields Tally expects (PARTYLEDGERNAME, ALLLEDGERENTRIES.LIST, ALLINVENTORYENTRIES.LIST, BILLALLOCATIONS, etc.) in MongoDB at write time. The "Export to Tally" path then becomes a pure XML serialization step with zero field mapping.

The existing Invoice MongoDB model (`models/Invoice.js`) is extended with a new `tallyVoucher` sub-document. All current fields — payment tracking, Excel metadata, dealer links, GRN links, finance report fields — are preserved intact. A migration script normalises existing records into the new sub-document. The invoice listing UI, payment tracking, dealer app, finance reports, and the Tally → ERP pull pipeline are all unaffected.

---

## Glossary

- **ERP_System**: The chakraIndustries backend Node.js / Express application.
- **Invoice**: A MongoDB document stored in the `invoices` collection. Represents a Sales transaction.
- **TallyVoucher**: The new nested sub-document inside an Invoice that mirrors the structure of a Tally Sales Voucher XML envelope.
- **ALLLEDGERENTRIES.LIST**: The list of accounting ledger entries inside a Tally Sales Voucher (party debit, GST credits, sales account credit).
- **ALLINVENTORYENTRIES.LIST**: The list of stock line items inside a Tally Sales Voucher.
- **BILLALLOCATIONS.LIST**: The bill reference list nested under the party ledger entry in Tally, used for bill-wise outstanding tracking.
- **Excel_Processor**: The service logic inside `invoiceController.bulkUpload` that transforms raw Excel row objects into Invoice documents.
- **Tally_Serializer**: The new export function that converts a stored TallyVoucher sub-document directly into Tally XML without any field mapping.
- **Tally_Mapper**: The existing field-mapping logic inside `tallyExportService.exportSalesInvoices` that is replaced by the Tally_Serializer.
- **Migration_Script**: A one-time Node.js script that reads existing Invoice documents and populates their TallyVoucher sub-document.
- **GST_Ledger_Resolver**: The logic that selects the correct CGST/SGST/IGST ledger name based on tax amounts and available Tally ledger names.
- **Voucher_Normalizer**: The function (called at write time) that converts raw invoice input data into a validated TallyVoucher sub-document.
- **Grand_Total**: The final invoice amount: `subtotal − totalDiscount + totalTax`.
- **Sales_Base**: The taxable base amount: `grandTotal − totalCGST − totalSGST − totalIGST`.
- **Tally_Date**: Invoice date formatted as `YYYYMMDD` (e.g., `20250701`).
- **Period_End**: The last date of the currently open Tally accounting period, used to cap voucher dates that fall outside the period.
- **Connector**: The srichakra-connector relay process that forwards Tally XML requests from the cloud ERP to a local Tally installation.
- **PARTYLEDGERNAME**: The exact name of the customer ledger in Tally — must match a ledger in Tally's chart of accounts.

---

## Requirements

### Requirement 1: TallyVoucher Sub-Document Schema

**User Story:** As a developer, I want a well-defined TallyVoucher sub-document schema stored inside every Invoice, so that export logic has a single authoritative, fully-validated structure to serialise and the fragile field-mapping step is eliminated.

#### Acceptance Criteria

1. THE ERP_System SHALL define a `tallyVoucherSchema` Mongoose sub-document containing all fields required for a Tally Sales Voucher: `voucherType` (String), `voucherNumber` (String), `date` (String, YYYYMMDD), `effectiveDate` (String, YYYYMMDD), `partyLedgerName` (String), `isinvoice` (Boolean, default true), `buyersOrderNo` (String), `narration` (String), `allLedgerEntries` (Array), `allInventoryEntries` (Array), and `billAllocations` (Array).
2. THE ERP_System SHALL embed a `tallyVoucher` field (using `tallyVoucherSchema`) in the existing `invoiceSchema`, defaulting to `null` when not yet populated.
3. THE ERP_System SHALL store `allLedgerEntries` as an array where each entry has the fields: `ledgerName` (String), `isDeemedPositive` (Boolean), `isLastDeemedPositive` (Boolean), `amount` (Number), and an optional nested `billAllocations` array with fields `name` (String), `billType` (String), and `amount` (Number).
4. THE ERP_System SHALL store `allInventoryEntries` as an array where each entry has the fields: `stockItemName` (String), `isDeemedPositive` (Boolean), `rate` (String, format `"value/Unit"`), `amount` (Number), `actualQty` (String, format `"qty Unit"`), `billedQty` (String, format `"qty Unit"`), and a nested `accountingAllocations` array with fields `ledgerName` (String), `isDeemedPositive` (Boolean), and `amount` (Number).
5. WHEN a `tallyVoucher` sub-document is stored and `allLedgerEntries` is non-empty, THE ERP_System SHALL enforce that the sum of all `allLedgerEntries[].amount` values equals zero within a tolerance of 0.01 (voucher must balance); IF the balance check fails, THEN THE ERP_System SHALL reject the save with a validation error that includes the actual imbalance amount.
6. THE ERP_System SHALL preserve all existing top-level fields in `invoiceSchema` (including `partyName`, `items`, `grandTotal`, `status`, `paymentStatus`, `paidAmount`, `source`, `uploadBatch`, `buyersOrderNo`, all Excel metadata fields, `tallySync`, `tallyGuid`, `dealerId`, `salesOrderId`, `grnId`) without modification.
7. WHEN the `tallyVoucher` sub-document is null or absent, THE ERP_System SHALL return valid results (non-error HTTP responses and correct aggregation values) for all existing invoice listing, payment tracking, and finance report API endpoints.

---

### Requirement 2: Voucher Normalizer Function

**User Story:** As a developer, I want a single `normalizeToTallyVoucher(invoiceData, options)` function that produces a validated TallyVoucher sub-document from raw invoice input, so that the same normalization logic is used consistently across Excel upload, manual entry, and the migration script.

#### Acceptance Criteria

1. THE Voucher_Normalizer SHALL accept a raw invoice object and an `options` object (containing `gstLedgerNames`, `periodEnd`, and `companyName`) and return a complete TallyVoucher sub-document containing all of: `voucherType`, `voucherNumber`, `date`, `effectiveDate`, `partyLedgerName`, `isinvoice`, `buyersOrderNo`, `narration`, `allLedgerEntries`, `allInventoryEntries`, and `billAllocations`; IF `invoiceData.invoiceNo` or `invoiceData.partyName` is absent or empty, THEN THE Voucher_Normalizer SHALL throw an error naming the missing field before performing any other computation.
2. THE Voucher_Normalizer SHALL set `partyLedgerName` to `invoiceData.partyName`, trimmed of leading and trailing whitespace.
3. THE Voucher_Normalizer SHALL format `date` and `effectiveDate` as `YYYYMMDD` strings derived from `invoiceData.invoiceDate`; IF `invoiceData.invoiceDate` is absent, null, or not parseable as a date, THEN `date` and `effectiveDate` SHALL be set to today's date in `YYYYMMDD` format; WHEN the resolved date string is lexicographically greater than `options.periodEnd` (and `options.periodEnd` is a non-empty string), THEN `date` and `effectiveDate` SHALL be set to `options.periodEnd`.
4. THE Voucher_Normalizer SHALL compute `allLedgerEntries` as an ordered array where `grandTotal = invoiceData.grandTotal || invoiceData.totalAmount` and `Sales_Base = grandTotal − totalCGST − totalSGST − totalIGST`, containing: (a) one party ledger entry with `ledgerName = partyLedgerName`, `isDeemedPositive=true`, `isLastDeemedPositive=true`, `amount = −grandTotal`, and a nested `billAllocations` entry with `name = invoiceNo`, `billType="New Ref"`, `amount = −grandTotal`; (b) one CGST entry when `totalCGST > 0`; (c) one SGST entry when `totalSGST > 0`; (d) one IGST entry when `totalIGST > 0`; (e) one "Sales Accounts" credit entry with `amount = +salesBase` ONLY WHEN `allInventoryEntries` resolves to an empty array.
5. THE Voucher_Normalizer SHALL set `isDeemedPositive=false`, `isLastDeemedPositive=false`, and a positive `amount` value for every GST ledger entry and the Sales Accounts entry.
6. IF the sum of item `amount` values across `invoiceData.items` equals `Sales_Base` within a tolerance of 0.01, THEN THE Voucher_Normalizer SHALL compute `allInventoryEntries` from `invoiceData.items`.
7. IF the sum of item `amount` values differs from `Sales_Base` by more than 0.01, THEN THE Voucher_Normalizer SHALL set `allInventoryEntries` to an empty array and include the top-level "Sales Accounts" ledger entry (criterion 4e) instead.
8. THE Voucher_Normalizer SHALL format each inventory entry `rate` field as `"value/Unit"` (e.g., `"100.00/Nos"`) and each `actualQty` and `billedQty` as `"qty Unit"` (e.g., `"5 Nos"`).
9. IF `options.gstLedgerNames` is a non-null, non-empty array, THEN THE Voucher_Normalizer SHALL pass it to the `GST_Ledger_Resolver` to select CGST/SGST/IGST ledger names; IF the resolver returns an empty string or null, THEN THE Voucher_Normalizer SHALL use the plain fallback names `"CGST"`, `"SGST"`, and `"IGST"` respectively.
10. THE Voucher_Normalizer SHALL validate that the produced TallyVoucher satisfies the balance invariant (sum of all `allLedgerEntries[].amount` = 0 within 0.01) before returning; IF the voucher does not balance, THEN THE Voucher_Normalizer SHALL throw an error whose message includes the string `"imbalanced"` and the numeric imbalance value (e.g., `"imbalanced by 0.50"`).
11. THE Voucher_Normalizer SHALL make no calls to `mongoose`, `fetch`, `axios`, `http`, `https`, `fs`, or any module that performs I/O; its only observable output SHALL be its return value or thrown error.

---

### Requirement 3: Excel Upload — Tally-Native Normalization at Write Time

**User Story:** As a finance operations user, I want every invoice created by Excel upload to immediately contain a complete TallyVoucher sub-document, so that export to Tally requires no field mapping and common mapping errors (wrong RATE format, wrong ledger names, imbalanced vouchers) are caught before the data enters the database.

#### Acceptance Criteria

1. WHEN the `Excel_Processor` processes a bulk upload request, THE ERP_System SHALL invoke the `Voucher_Normalizer` for each invoice row before inserting the document into MongoDB.
2. WHEN the `Voucher_Normalizer` returns a valid TallyVoucher for a row, THE ERP_System SHALL store it in the row's `tallyVoucher` field.
3. IF the `Voucher_Normalizer` throws a balance error for a row, THEN THE ERP_System SHALL include that row in the upload error report (with the reason) and SHALL NOT insert the document.
4. THE ERP_System SHALL continue inserting all other valid rows even when some rows fail normalization (ordered:false semantics preserved).
5. THE ERP_System SHALL return a response that distinguishes rows that inserted successfully, rows that failed normalization (with reason), and rows that failed MongoDB validation.
6. WHEN a `gstLedgerNames` configuration is available in `TallyConfig`, THE ERP_System SHALL pass it to the `Voucher_Normalizer` during upload processing.
7. IF no `TallyConfig` is available at upload time, THEN THE ERP_System SHALL pass `null` for `gstLedgerNames` and the `Voucher_Normalizer` SHALL use fallback ledger names.

---

### Requirement 4: Manual Entry — Tally-Native Normalization at Write Time

**User Story:** As a finance operations user, I want every invoice created via manual entry to contain a complete TallyVoucher sub-document, so that the export path is consistent regardless of how the invoice was created.

#### Acceptance Criteria

1. WHEN the `invoiceController.create` endpoint processes a manual invoice creation request, THE ERP_System SHALL invoke the `Voucher_Normalizer` and store the result in `tallyVoucher` before saving.
2. IF the `Voucher_Normalizer` fails during manual invoice creation, THEN THE ERP_System SHALL halt the save process and return an HTTP 400 response with a descriptive error message identifying the field that caused the failure.
3. WHEN the `invoiceController.update` endpoint processes an invoice update, THE ERP_System SHALL re-invoke the `Voucher_Normalizer` on every save (including status-only and comment-only updates) and replace the stored `tallyVoucher` with the updated version.
4. IF the `Voucher_Normalizer` fails during an invoice update, THEN THE ERP_System SHALL leave the existing `tallyVoucher` unchanged and return an HTTP 400 response with a descriptive error message.
5. WHEN `tallySync` is `true` on an invoice and an update is submitted, THE ERP_System SHALL set `tallySync` to `false` and clear `tallySyncAt` so the updated invoice is re-exported to Tally on the next export run.

---

### Requirement 5: Tally Export — Pure XML Serialization

**User Story:** As a finance operations user, I want the "Export to Tally" function to serialize the stored TallyVoucher sub-document directly to Tally XML with no field mapping, so that silent EXCEPTIONS caused by mapping errors are permanently eliminated.

#### Acceptance Criteria

1. THE Tally_Serializer SHALL read the `tallyVoucher` sub-document from each Invoice and produce a Tally XML `<VOUCHER>` element by wrapping each stored field in its corresponding XML tag using the field names from the `tallyVoucherSchema`.
2. THE Tally_Serializer SHALL NOT compute amounts, ledger names, rate formats, or date conversions at serialization time — all computed values SHALL already be present in the stored `tallyVoucher`.
3. WHEN an Invoice has `tallyVoucher = null` or `tallyVoucher` is undefined (legacy invoice not yet migrated), THE ERP_System SHALL fall back to the existing `Tally_Mapper` logic for that invoice AND SHALL write a `TallySyncLog` entry of type `"Sales Invoice"` with `status = "Warning"` and a message containing the string `"tallyVoucher missing — used legacy mapper"`.
4. THE Tally_Serializer SHALL XML-escape all string values (replacing `&` with `&amp;`, `<` with `&lt;`, `>` with `&gt;`, `"` with `&quot;`, `'` with `&apos;`) before inserting them into XML tags.
5. THE Tally_Serializer SHALL emit `<ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>` when the entry's `isDeemedPositive` is `true`, and `<ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>` when `false`.
6. THE Tally_Serializer SHALL include `<ISINVOICE>Yes</ISINVOICE>` in every emitted voucher.
7. WHEN `tallyVoucher.allInventoryEntries` is non-empty, THE Tally_Serializer SHALL NOT emit a top-level `<ALLLEDGERENTRIES.LIST>` for "Sales Accounts" (the accounting allocation is already inside each inventory entry's `accountingAllocations`).
8. THE Tally_Serializer SHALL execute the following pipeline steps for each export run, in order: (a) auto-detect and update company name from Tally; (b) fetch and cache `periodEnd`; (c) fetch existing Sales voucher numbers from Tally for deduplication; (d) fetch PO-number map for Create-vs-Alter decisions; (e) auto-create required ledgers and stock items before sending vouchers.
9. WHEN Tally returns `<CREATED>` or `<ALTERED>` count ≥ 1 for a batch that also has `<EXCEPTIONS>` count ≥ 1, THE ERP_System SHALL mark only the invoices in that batch whose voucher number appears in Tally's existing voucher number set (fetched in step 8c) as `tallySync=true`; invoices whose voucher number is absent from that set SHALL NOT be marked as synced and SHALL be retried on the next export run.

---

### Requirement 6: GST Ledger Resolver

**User Story:** As a developer, I want a deterministic GST_Ledger_Resolver that selects the correct Tally ledger name for CGST, SGST, and IGST amounts, so that ledger name mismatches are resolved consistently and logged when a fallback is used.

#### Acceptance Criteria

1. THE GST_Ledger_Resolver SHALL accept `taxType` (`"cgst"`, `"sgst"`, or `"igst"`), `salesBase` (Number), `taxAmount` (Number), and `availableLedgerNames` (array of strings from Tally, or null).
2. WHEN `availableLedgerNames` is non-null and contains a ledger whose name matches the expected rate-suffix pattern (e.g., `"Output CGST @ 9%"` for a 9 % rate), THE GST_Ledger_Resolver SHALL return that ledger name.
3. WHEN `availableLedgerNames` is non-null but contains no rate-specific match, THE GST_Ledger_Resolver SHALL return the plain name (`"CGST"`, `"SGST"`, or `"IGST"`) if present in the list.
4. WHEN `availableLedgerNames` is null or empty, THE GST_Ledger_Resolver SHALL return the plain fallback name (`"CGST"`, `"SGST"`, or `"IGST"`).
5. THE GST_Ledger_Resolver SHALL be a pure function with no side effects.
6. FOR ALL inputs where `taxAmount > 0` and `salesBase > 0`, THE GST_Ledger_Resolver SHALL return a non-empty string.

---

### Requirement 7: Migration Script

**User Story:** As a developer deploying this feature to production, I want a migration script that populates the `tallyVoucher` sub-document on all existing Invoice documents, so that the new export path works for all invoices without data corruption or downtime.

#### Acceptance Criteria

1. THE Migration_Script SHALL process all Invoice documents in the `invoices` collection in batches of 100, using cursor-based pagination ordered by `_id` ascending.
2. WHEN an Invoice document has `tallyVoucher = null` or `tallyVoucher` absent (field not present on the document), THE Migration_Script SHALL invoke the `Voucher_Normalizer` with the invoice's existing field values and write the result using a targeted `{ $set: { tallyVoucher: <result> } }` update that modifies only the `tallyVoucher` field.
3. IF the `Voucher_Normalizer` throws for an invoice during migration, THEN THE Migration_Script SHALL log the invoice `_id`, `invoiceNo`, and the full error message to standard output, skip that document, and continue processing the remaining documents in the batch.
4. THE Migration_Script SHALL write a summary report to both standard output and a timestamped log file (e.g., `migration-tally-voucher-<ISO timestamp>.log`) in the script's working directory at completion, containing: total documents processed, total succeeded, total failed, and for each failure: `_id`, `invoiceNo`, and error reason.
5. THE Migration_Script SHALL NOT issue any update to a document other than the `{ $set: { tallyVoucher: <result> } }` operation described in criterion 2; no other field SHALL be read from or written to.
6. THE Migration_Script SHALL NOT invoke the `Voucher_Normalizer` for invoices that already have a non-null `tallyVoucher` value on any run; these documents SHALL be counted as "skipped" in the summary report.
7. IF the `Migration_Script` is interrupted and re-run, THEN THE Migration_Script SHALL produce the same final database state as if it had run to completion without interruption, because criterion 6 ensures already-migrated documents are never re-processed.
8. WHEN a `tallyVoucher` field is completely absent from an Invoice document (not explicitly set to null, just missing from the BSON), THE Migration_Script SHALL treat it as needing migration and invoke the `Voucher_Normalizer` for that invoice.
9. THE Migration_Script SHALL complete processing of 10,000 Invoice documents in under 5 minutes on a single-core 1 GB RAM Node.js environment.
10. IF a database batch read or write operation throws an error (e.g., network timeout, MongoDB write concern failure), THEN THE Migration_Script SHALL log the batch start offset, error message, and count of documents in the failed batch, then continue processing subsequent batches; the failed batch's documents SHALL be retried on the next script run (they will still have `tallyVoucher = null`).

---

### Requirement 8: Backward Compatibility — Invoice Listing and Payment Tracking

**User Story:** As a finance operations user, I want all existing invoice management features (listing, search, status updates, payment recording, finance reports) to work without any change after the migration, so that the architectural change is invisible to end users.

#### Acceptance Criteria

1. THE ERP_System SHALL continue to expose all existing Invoice API fields (`invoiceNo`, `partyName`, `grandTotal`, `status`, `paymentStatus`, `paidAmount`, `remainingAmount`, `source`, `uploadBatch`, `items`, etc.) in all GET responses.
2. THE ERP_System SHALL continue to update `paymentStatus` and `remainingAmount` via the existing `pre('save')` hook when `paidAmount` or `grandTotal` is modified.
3. THE ERP_System SHALL continue to support all existing MongoDB index queries: `invoiceNo`, `status`, `partyName`, `invoiceDate`.
4. THE ERP_System SHALL continue to serve the dealer app's invoice queries without change to response shape.
5. THE ERP_System SHALL continue to generate finance report aggregations (`$sum: '$grandTotal'`) without change.
6. THE ERP_System SHALL continue to support the `salesOrderId` and `dealerId` reference fields for sales order linking and dealer associations.

---

### Requirement 9: Backward Compatibility — Tally → ERP Pull

**User Story:** As a developer, I want the Tally → ERP import pipeline (pull of Sales vouchers from Tally into ERP) to continue working after this feature is deployed, so that vouchers created directly in Tally are still reflected in the ERP.

#### Acceptance Criteria

1. THE ERP_System SHALL continue to import Tally Sales Vouchers via the existing `tallyFetchEngine` pull mechanism.
2. WHEN a Sales Voucher is pulled from Tally, THE ERP_System SHALL populate both the top-level Invoice fields (for UI compatibility) AND the `tallyVoucher` sub-document (so the pulled voucher is export-ready if re-exported).
3. THE ERP_System SHALL set `source = "Tally"` on invoices imported from Tally, and those invoices SHALL remain excluded from the ERP → Tally export queue.
4. THE ERP_System SHALL store the `tallyGuid` and `tallyAlterId` on pulled invoices without change.

---

### Requirement 10: UI Impact — Invoice Detail Page

**User Story:** As a finance operations user, I want the invoice detail page to render correctly from the new Tally-native stored structure, so that I can review, edit, and approve invoices without any change to the current workflow.

#### Acceptance Criteria

1. THE ERP_System SHALL expose a read-only `tallyVoucher` field in the Invoice detail API response for diagnostic purposes (visible to developers via the API, but not required to be displayed in the main UI).
2. THE ERP_System SHALL continue to render all invoice line items, party details, totals, and status from the existing top-level Invoice fields — the `tallyVoucher` sub-document is supplementary, not the primary render source.
3. WHEN a user edits and saves an invoice via the detail page, THE ERP_System SHALL re-normalize the `tallyVoucher` sub-document automatically (Requirement 4.2).
4. THE ERP_System SHALL display a visual indicator on the invoice detail page when `tallyVoucher` is `null` (i.e., migration not yet applied or normalization failed) to help operators identify un-migratable records.

---

### Requirement 11: Voucher Balance Invariant (Property-Based Test Target)

**User Story:** As a developer writing tests, I want a formally specified voucher balance invariant, so that property-based tests can verify the Voucher_Normalizer produces balanced vouchers for any valid invoice input.

#### Acceptance Criteria

1. FOR ALL valid Invoice inputs, THE Voucher_Normalizer SHALL produce a TallyVoucher where: `sum(allLedgerEntries[].amount) = 0`.
2. FOR ALL valid Invoice inputs, THE Voucher_Normalizer SHALL produce a TallyVoucher where: `allLedgerEntries[party entry].amount = −grandTotal`.
3. FOR ALL valid Invoice inputs where `allInventoryEntries` is non-empty: `sum(allInventoryEntries[].amount) = −Sales_Base` (inventory entries sum to negative sales base).
4. FOR ALL valid Invoice inputs where `allInventoryEntries` is non-empty: `sum(accountingAllocations[].amount within each inventory entry) = allInventoryEntries[].amount`.
5. FOR ALL valid Invoice inputs, THE Voucher_Normalizer SHALL produce a TallyVoucher where `date` is a valid `YYYYMMDD` string and is less than or equal to `periodEnd`.

---

### Requirement 12: TallyVoucher Round-Trip Serialization (Property-Based Test Target)

**User Story:** As a developer, I want a round-trip property for TallyVoucher serialization, so that tests can verify the Tally_Serializer produces XML that, when re-parsed, recovers the original TallyVoucher field values.

#### Acceptance Criteria

1. FOR ALL TallyVoucher sub-documents, THE Tally_Serializer SHALL produce XML that, when parsed with an XML parser, yields the original `voucherNumber`, `partyLedgerName`, `date`, `buyersOrderNo`, and `narration` values.
2. FOR ALL TallyVoucher sub-documents, THE Tally_Serializer SHALL produce XML that, when parsed, yields the original `allLedgerEntries` array with the same `ledgerName`, `isDeemedPositive`, and `amount` values for each entry.
3. FOR ALL TallyVoucher sub-documents where `allInventoryEntries` is non-empty, THE Tally_Serializer SHALL produce XML that, when parsed, yields the original `stockItemName`, `rate`, `amount`, `actualQty`, and `billedQty` for each item.
4. THE Tally_Serializer SHALL produce well-formed XML for any TallyVoucher with ASCII, Unicode, and special characters (`&`, `<`, `>`, `"`, `'`) in string fields.

---

### Requirement 13: GST Ledger Resolver Round-Trip (Property-Based Test Target)

**User Story:** As a developer, I want the GST_Ledger_Resolver to be fully deterministic, so that tests can verify it returns a non-empty string for every valid input.

#### Acceptance Criteria

1. FOR ALL inputs where `taxAmount > 0` and `salesBase > 0` and `taxType ∈ {"cgst", "sgst", "igst"}`, THE GST_Ledger_Resolver SHALL return a non-empty, non-null string.
2. FOR ALL inputs where `availableLedgerNames` is the same list, THE GST_Ledger_Resolver SHALL return the same ledger name for the same `taxType` and `taxAmount/salesBase` ratio (deterministic, no randomness).
3. WHEN `availableLedgerNames` contains only the plain names `["CGST", "SGST", "IGST"]`, THE GST_Ledger_Resolver SHALL return `"CGST"` for `taxType="cgst"`, `"SGST"` for `taxType="sgst"`, and `"IGST"` for `taxType="igst"`.
