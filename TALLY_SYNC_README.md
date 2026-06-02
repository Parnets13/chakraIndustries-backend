# Tally Bi-Directional Synchronization

Complete guide to the ERP ↔ Tally integration with GUID-based duplicate prevention.

## Features

✅ **Bi-directional sync** — ERP → Tally and Tally → ERP  
✅ **GUID / AlterID tracking** — prevents duplicate records  
✅ **Full entity support** — Customers, Vendors, Products, Invoices, POs, Payments, Receipts  
✅ **Manual & Scheduled sync** — trigger manually or auto-sync every 5/15/30/60 minutes  
✅ **Webhook support** — Tally can push changes to ERP in real-time  
✅ **Production-ready** — uses `https://erp.majesticmall.net` as the Tally XML API endpoint

---

## Architecture

### Models Enhanced with GUID Fields

| Model | GUID Fields Added |
|-------|------------------|
| `ItemMaster` | `tallyGuid`, `tallyAlterId`, `tallySynced`, `lastTallySync`, `tallyStockName` |
| `Vendor` | `tallyGuid`, `tallyAlterId`, `tallySynced`, `lastTallySync`, `tallyMasterType` |
| `Client` | `tallyGuid`, `tallyAlterId`, `tallySynced`, `lastTallySync` |
| `AccountsLedger` | Already had `tallyGuid`, `tallyLedgerId` |
| `PurchaseOrder` | `tallyGuid`, `tallyAlterId`, `tallyVoucherNumber` |
| `Invoice` | `tallyGuid`, `tallyAlterId`, `tallyVoucherNumber` |
| **NEW:** `TallyVoucher` | Stores Payment/Receipt vouchers from Tally |

### New Model: TallyVoucher

Stores Payment and Receipt vouchers pulled from Tally:

```javascript
{
  tallyGuid: String,           // Tally's unique identifier
  tallyAlterId: String,        // Tally's alter ID
  voucherNumber: String,       // Voucher number
  voucherType: String,         // Payment, Receipt, Journal, etc.
  voucherDate: Date,
  partyName: String,
  amount: Number,
  narration: String,
  ledgerEntries: [{ ledgerName, amount, isDeemed }],
  linkedInvoiceId: ObjectId,   // Link to ERP Invoice
  linkedPoId: ObjectId,        // Link to ERP PurchaseOrder
  source: 'Tally' | 'ERP'
}
```

---

## Configuration

### Backend `.env`

```env
# Tally API endpoint (default: https://erp.majesticmall.net)
TALLY_API_URL=https://erp.majesticmall.net
```

### TallyConfig Model

Enhanced with new sync preferences:

```javascript
{
  serverUrl: 'https://erp.majesticmall.net',  // Production Tally endpoint
  port: '9000',
  companyName: '',                            // Optional — blank = use active company
  authType: 'None' | 'Basic Auth' | 'API Key',
  apiKey: '',
  
  // New fields for bi-directional sync
  enableGuidTracking: true,
  syncCustomers: true,
  syncVendors: true,
  syncProducts: true,
  syncInvoices: true,
  syncPurchaseOrders: true,
  syncReceipts: true,
  syncPayments: true,
  
  // Original fields
  autoSync: true,
  syncInterval: 'Every 15 minutes',
  syncDirection: 'Bi-directional',
  syncPrefs: {
    masterData: true,
    purchaseVouchers: true,
    salesVouchers: true,
    paymentVouchers: true,
    receiptVouchers: true,
    journalVouchers: false
  }
}
```

---

## API Endpoints

### New Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tally/vouchers` | List payment/receipt vouchers |
| `POST` | `/api/tally/vouchers` | Create new voucher (ERP → Tally) |
| `DELETE` | `/api/tally/vouchers/:id` | Delete voucher |
| `GET` | `/api/tally/guid-status` | Check GUID sync status for all entities |

### Existing Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/tally/config` | Get Tally configuration |
| `POST` | `/api/tally/config` | Save Tally configuration |
| `POST` | `/api/tally/test-connection` | Test Tally connectivity |
| `POST` | `/api/tally/sync` | Trigger manual sync (body: `{ type: 'Full' }`) |
| `GET` | `/api/tally/logs` | Get sync logs |
| `GET` | `/api/tally/stats` | Get sync statistics |
| `POST` | `/api/tally/webhook` | Receive XML pushed from Tally |

---

## Sync Operations

### ERP → Tally (Push)

1. **`pushMastersToTally`** — Pushes all masters in one request:
   - Stock Items (with GUID for dedup)
   - System Ledgers (Purchase Accounts, Sales Accounts, CGST, SGST, IGST)
   - Vendor Ledgers (Sundry Creditors)
   - Customer Ledgers (Clients + Corporate Clients, Sundry Debtors)
   - Accounts Ledgers

2. **`pushPurchaseVouchersToTally`** — Purchase Orders as Purchase vouchers

3. **`pushSalesVouchersToTally`** — Invoices as Sales vouchers

4. **`pushPaymentVouchersToTally`** — Payment vouchers from `TallyVoucher` collection

5. **`pushReceiptVouchersToTally`** — Receipt vouchers from `TallyVoucher` collection

### Tally → ERP (Pull)

1. **`pullItemsFromTally`** — Stock items (stores GUID to prevent duplicates)

2. **`pullLedgersFromTally`** — Ledgers (upserts Vendors from Sundry Creditors, Clients from Sundry Debtors)

3. **`pullVouchersFromTally`** — Sales and Purchase vouchers (stores GUID)

4. **`pullPaymentReceiptFromTally`** — Payment and Receipt vouchers → `TallyVoucher` model

### Full Sync (`runFullSync`)

Runs all operations in sequence:

**Phase 1 (ERP → Tally):**  
Masters → Purchase Vouchers → Sales Vouchers → Payments → Receipts

**Phase 2 (Tally → ERP):**  
Stock Items → Ledgers → Sales Vouchers → Purchase Vouchers → Payments → Receipts

---

## GUID-Based Deduplication

### How It Works

1. **First Sync:** Record is created in Tally → Tally returns `<GUID>` in response → ERP stores GUID in `tallyGuid` field

2. **Subsequent Syncs:** ERP checks if record has `tallyGuid` → if yes, uses `ACTION="Alter"` instead of `ACTION="Create"` → Tally updates existing record instead of creating duplicate

3. **Pull from Tally:** ERP extracts GUID from Tally XML → upserts using `{ tallyGuid: guid }` filter → prevents duplicate insertion

### Example

**Push (ERP → Tally):**

```xml
<STOCKITEM NAME="Widget A" ACTION="Alter">
  <NAME>Widget A</NAME>
  <UNITS>Nos</UNITS>
  <GUID>{12345678-1234-1234-1234-123456789012}</GUID>
</STOCKITEM>
```

**Pull (Tally → ERP):**

```javascript
// ERP upsert logic
const guid = extractGuid(xmlBlock);
const filter = guid ? { tallyGuid: guid } : { name: 'Widget A' };
await ItemMaster.updateOne(filter, { $set: { ...data, tallyGuid: guid } }, { upsert: true });
```

---

## Webhook (Tally → ERP Push)

Tally can push changes in real-time to:

**Endpoint:** `POST https://your-erp-domain.com/api/tally/webhook`

### Supported Entity Types

- Stock Items (`<STOCKITEM>`) → upserted to `ItemMaster`
- Ledgers (`<LEDGER>`) → upserted to `AccountsLedger`, `Vendor`, `Client`
- Sales Vouchers (`<VOUCHER VCHTYPE="Sales">`) → upserted to `Invoice`
- Payment/Receipt Vouchers → upserted to `TallyVoucher`

### Security

Set `authType: 'API Key'` and `apiKey: 'your-secret'` in TallyConfig. The webhook checks:

```javascript
const secret = req.headers['x-tally-secret'] || req.headers['authorization']?.replace('Bearer ','');
if (secret !== cfg.apiKey) return res.status(401).json({ success: false, message: 'Unauthorized' });
```

---

## Manual Sync (Frontend)

### Trigger Full Sync

```javascript
import { tallyApi } from '@/api/tallyApi';

const handleFullSync = async () => {
  const result = await tallyApi.fullSync();
  if (result.offline) {
    alert('Tally is offline. Check connection.');
  } else if (result.success) {
    alert(`Synced ${result.data.records} records`);
  }
};
```

### Trigger Targeted Sync

```javascript
// Sync only masters (items + ledgers)
await tallyApi.triggerSync({ type: 'master' });

// Sync only purchase vouchers
await tallyApi.triggerSync({ type: 'Purchase' });

// Sync only payments
await tallyApi.triggerSync({ type: 'Payment' });
```

---

## Scheduled Sync

Configured in TallyConfig UI or via API:

```javascript
{
  "autoSync": true,
  "syncInterval": "Every 15 minutes"  // Options: 5/15/30/60 minutes, Manual only
}
```

The scheduler (`services/tallyScheduler.js`) checks config every 60 seconds and adjusts the interval automatically.

---

## GUID Sync Status

Check how many records have GUID tracking enabled:

```javascript
const status = await tallyApi.getGuidStatus();
console.log(status.data);
// {
//   items: { synced: 120, total: 150, percentage: '80.0' },
//   vendors: { synced: 45, total: 50, percentage: '90.0' },
//   ...
// }
```

---

## Troubleshooting

### Issue: Duplicate records in Tally

**Cause:** Record was created without GUID tracking (e.g., old sync before this update).

**Fix:**
1. Run full sync to populate GUID fields in ERP
2. Records will use `ACTION="Alter"` on next sync
3. Or manually delete duplicates in Tally and re-sync

### Issue: Tally not reachable (offline error)

**Cause:** Tally HTTP Server is not enabled or wrong URL.

**Fix:**
1. Open Tally Prime
2. Press `F12` (Configure)
3. Advanced Configuration → Enable ODBC / HTTP Server: **Yes**
4. Port: **9000**
5. Test connection in ERP: `POST /api/tally/test-connection`

### Issue: Some records not syncing

**Cause:** Validation errors (e.g., missing GST number, invalid phone format).

**Fix:** Check sync logs (`GET /api/tally/logs`) for error details. Fix data in ERP and retry.

---

## Migration Guide (Existing Installations)

If upgrading from the old implementation:

1. **Run database migration** to add GUID fields:
   ```bash
   # No manual migration needed — Mongoose will create fields on first document save
   ```

2. **Update TallyConfig** to use production endpoint:
   ```javascript
   await TallyConfig.updateOne({}, { $set: { serverUrl: 'https://erp.majesticmall.net' } });
   ```

3. **Run full sync** to populate GUID fields:
   ```bash
   POST /api/tally/sync
   Body: { "type": "Full" }
   ```

4. **Verify GUID status:**
   ```bash
   GET /api/tally/guid-status
   ```

---

## License

Proprietary — Sri Chakra Industries ERP System
