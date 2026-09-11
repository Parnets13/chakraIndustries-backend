# Chakra Backend — RAM / CPU Load Test

Measures **actual** RAM and CPU consumption of the Chakra ERP backend during a
production-like 1,000-record invoice upload + Tally export workflow.

---

## Files in this folder

| File | Purpose |
|------|---------|
| `generate-test-invoices.js` | Generates `test-invoices-1000.xlsx` — a 1,000-row realistic Excel file |
| `ram-monitor.js` | RamMonitor class + system RAM/CPU sampling utilities |
| `monitor-patch.js` | Documents the 3-line snippet needed in `server.js` |
| `load-test-runner.js` | Main orchestrator — runs all 7 phases and produces the report |
| `load-test-report.txt` | **Output** — human-readable result (created after run) |
| `load-test-result.json` | **Output** — full JSON with every sample (created after run) |

---

## What gets measured

| Metric | How |
|--------|-----|
| Node.js process RSS | `GET /api/health/memory` → `process.memoryUsage().rss` |
| Node.js heap used / total | Same endpoint |
| System total / used / free RAM | Node.js `os` module — no native bindings |
| System CPU % | `wmic cpu get LoadPercentage` (Windows) |
| Per-phase breakdown | Monitor labels each sample with current phase name |
| Peak across all phases | Derived from the full sample array after test completes |
| Memory release | Compares post-GC RSS vs peak RSS vs idle RSS |

---

## Prerequisites

1. **Node.js ≥ 18** (project already uses it)
2. **`xlsx` package** — already in `package.json` dependencies
3. **Backend running** on `http://localhost:5000`
4. **One 3-line addition to `server.js`** — see Step 1 below

---

## Step 1 — Add the memory probe endpoint to server.js (one-time)

Open `chakraIndustries-backend/server.js` and find the existing `/api/health` route
(around line 250). Add the snippet **immediately after it**:

```js
// ── Load-test memory probe (temporary — remove after testing) ──────────────
app.get('/api/health/memory', (_req, res) => {
  res.json(process.memoryUsage());
});
```

> **Why this is safe:**
> - Read-only — returns only `process.memoryUsage()`.
> - No authentication, no database access, no side effects.
> - Only runs during load test on localhost.
> - Remove it after the test if you want to keep `server.js` clean.
> - The test runner will tell you exactly if this step is missing.

**Restart the backend after adding this line.**

---

## Step 2 — Generate the test Excel file (one-time)

```powershell
# Run from the backend root
cd d:\chakraproject\chakraIndustries-backend
node load-test/generate-test-invoices.js
```

Expected output:
```
✓ Excel file generated successfully
  Rows     : 1000 invoices
  Parties  : 20 unique companies
  Items    : 15 unique products
  File     : ...\load-test\test-invoices-1000.xlsx
  Size     : ~140 KB
```

This is **safe** — creates only a local `.xlsx` file, no network or DB calls.

---

## Step 3 — Start the backend (in a separate terminal)

```powershell
cd d:\chakraproject\chakraIndustries-backend
npm run dev
```

Wait until you see:
```
✓ Server running on port 5000
✓ MongoDB connected successfully
```

---

## Step 4 — Run the load test

Open a **second terminal** (keep the backend running in the first):

```powershell
cd d:\chakraproject\chakraIndustries-backend

# Basic run — uses admin@chakra.com / admin123
node load-test/load-test-runner.js

# With your own credentials
$env:TEST_EMAIL="your@email.com"; $env:TEST_PASS="yourpassword"; node load-test/load-test-runner.js
```

The test takes **3–8 minutes** depending on:
- MongoDB Atlas latency (insert phase)
- Whether Tally is running locally (export phase)

---

## Environment variable options

| Variable | Default | Purpose |
|----------|---------|---------|
| `BACKEND_URL` | `http://localhost:5000` | Override backend URL |
| `TEST_EMAIL` | `admin@chakra.com` | Login email |
| `TEST_PASS` | `admin123` | Login password |
| `SKIP_TALLY` | not set | Set to `1` to skip the Tally export phase |
| `SKIP_CLEANUP` | not set | Set to `1` to keep test invoices in DB after run |
| `SKIP_MEMORY_ROUTE` | not set | Set to `1` to run with system RAM only (no RSS) |

### PowerShell syntax for multiple variables

```powershell
$env:TEST_EMAIL="admin@yourcompany.com"
$env:TEST_PASS="yourpassword"
$env:SKIP_TALLY="1"
node load-test/load-test-runner.js
```

---

## What the test does to your database

| Action | Reversible? | Notes |
|--------|-------------|-------|
| Inserts 1,000 Invoice documents | ✅ Yes | Tagged `uploadBatch: "LOADTEST-<timestamp>"` |
| Auto-creates ItemMaster entries | ✅ Yes | Only for item names not already in DB |
| Tally export (SSE stream) | N/A | Reads data only — no ERP DB writes |
| Cleanup (Phase 7) | Already done | Deletes all 1,000 test invoices by batch ID |

> **Production data is never touched.** The test only interacts with the
> `Invoice` and `ItemMaster` collections. All test invoices carry
> `uploadBatch: "LOADTEST-<timestamp>"` and are deleted automatically.
>
> If the test crashes before cleanup, delete manually:
> ```js
> // Run in MongoDB Atlas or via mongosh:
> db.invoices.deleteMany({ uploadBatch: /^LOADTEST-/ })
> ```

---

## What to do if Tally is not running

That's fine — set `SKIP_TALLY=1`:

```powershell
$env:SKIP_TALLY="1"
node load-test/load-test-runner.js
```

Or let the test run normally — the export phase will time out after 5 minutes and the
runner will continue to produce a complete report for all other phases. RAM measurement
during the timeout window is still valid.

---

## Reading the report

After the test completes, two files are written to `load-test/`:

### `load-test-report.txt` — Human-readable summary

```
═══════════════════════════════════════════════════════════════════
  CHAKRA BACKEND — RAM / CPU LOAD TEST RESULT
  ...

── PHASE-BY-PHASE RAM (Node.js RSS — actual process RAM) ──────

  Idle (baseline):                              XXX.X MB
  During Excel parsing:                         XXX.X MB
  During MongoDB insert:                        XXX.X MB
  During Tally export:                          XXX.X MB
  After export (post-GC):                       XXX.X MB

── PEAK MEASUREMENTS ──────────────────────────────────────────

  PEAK Node.js RSS:                             XXX.X MB
  PEAK CPU (system-wide):                          XX.X%
  ...

── AWS EC2 RAM SIZING RECOMMENDATION ──────────────────────────
  Based on ACTUAL measured peak: XXX.X MB
  ...
    512 MB EC2 : ✗  INSUFFICIENT ...
   1024 MB EC2 : ✓  MINIMUM — XXX MB free during export
   2048 MB EC2 : ✓✓ COMFORTABLE — XXX MB free during export
   ...
```

### `load-test-result.json` — Full machine-readable data

Contains every individual RAM sample (one per second), all phase aggregates,
and the complete snapshot at each phase transition. Useful if you want to
chart memory usage over time.

---

## Interpreting RSS vs Heap

| Metric | What it means |
|--------|---------------|
| **RSS** | Resident Set Size — total RAM the OS has allocated to the Node.js process. This is the number that matters for EC2 sizing. |
| **Heap Used** | V8 JavaScript heap actually occupied by live objects |
| **Heap Total** | V8 heap reserved (allocated but not all in use) |
| **External** | C++ objects linked to V8 — mainly `Buffer` allocations (file reads, XLSX parsing) |

**Use RSS for all EC2 sizing decisions.** RSS includes heap + stack + native modules +
Buffer allocations. It is what the OS charges your instance for.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Backend is not reachable` | Run `npm run dev` in the backend folder first |
| `Login failed` | Set `TEST_EMAIL` and `TEST_PASS` to valid credentials |
| `/api/health/memory not found` | Add the 3-line snippet to `server.js` (Step 1) |
| `Excel file not found` | Run `node load-test/generate-test-invoices.js` first (Step 2) |
| Tally export times out | Normal if Tally is not running — use `SKIP_TALLY=1` or let it timeout |
| Cleanup deletes 0 invoices | The `/api/invoices` list endpoint may paginate; invoices are still in DB — delete manually with the MongoDB query above |
| `Cannot find package 'xlsx'` | Run `npm install` in the backend folder |
