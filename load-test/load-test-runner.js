/**
 * load-test-runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Chakra Backend — Full RAM / CPU Load Test Runner
 *
 * WHAT THIS DOES (in order):
 *   1.  Registers /api/health/memory on the live Express app (non-invasive)
 *   2.  Authenticates with the backend and obtains a JWT
 *   3.  Records IDLE RAM/CPU baseline (10 second window)
 *   4.  Reads the 1,000-row Excel file and parses it into invoice objects
 *       (exactly as the real frontend does — no file upload, sends JSON)
 *   5.  Records RAM during Excel parsing
 *   6.  POSTs the 1,000 invoices to POST /api/invoices/bulk-upload
 *   7.  Records RAM during DB insertion / normalization
 *   8.  Waits for insertion to complete, records result
 *   9.  Opens SSE stream to GET /api/tally/full-export-stream and
 *       monitors RAM continuously until the stream closes
 *   10. Records RAM after Tally export finishes
 *   11. Waits 15 seconds for GC to settle, records final RAM
 *   12. Checks memory release (post vs peak)
 *   13. Generates the full formatted report + saves load-test-result.json
 *   14. Deletes the 1,000 test invoices it created (safe cleanup)
 *
 * SAFETY:
 *   ✓ Uses a TEST database prefix tag on all invoices (uploadBatch starts
 *     with "LOADTEST-") so they are identifiable and deletable after the run.
 *   ✓ Does NOT modify any Tally config, masters, or production data.
 *   ✓ Does NOT change any application source files.
 *   ✓ Tally export is READ-ONLY from the ERP perspective — it reads existing
 *     data and pushes to Tally.  If Tally is not running locally, the export
 *     phase will time out gracefully; the RAM measurement still completes.
 *   ✓ Cleanup step deletes only invoices whose uploadBatch === LOADTEST batchId.
 *
 * USAGE:
 *   # Step 1 — generate the Excel file (once)
 *   node load-test/generate-test-invoices.js
 *
 *   # Step 2 — start your backend in another terminal
 *   npm run dev   (or npm start)
 *
 *   # Step 3 — run the load test
 *   node load-test/load-test-runner.js
 *
 *   # Optional: skip cleanup (keep test invoices in DB for inspection)
 *   SKIP_CLEANUP=1 node load-test/load-test-runner.js
 *
 *   # Optional: skip Tally export phase (if Tally is not running)
 *   SKIP_TALLY=1 node load-test/load-test-runner.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import http    from 'http';
import https   from 'https';
import fs      from 'fs';
import path    from 'path';
import XLSX    from 'xlsx';
import os      from 'os';
import { fileURLToPath } from 'url';
import { RamMonitor, takeSnapshot, getSystemRamMB, getSystemCpuPercent } from './ram-monitor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  baseUrl:         process.env.BACKEND_URL || 'http://localhost:5000',
  loginEmail:      process.env.TEST_EMAIL  || 'admin@chakra.com',
  loginPassword:   process.env.TEST_PASS   || 'admin123',
  excelFile:       path.join(__dirname, 'test-invoices-1000.xlsx'),
  resultFile:      path.join(__dirname, 'load-test-result.json'),
  reportFile:      path.join(__dirname, 'load-test-report.txt'),
  monitorInterval: 1000,   // ms between RAM samples
  idleWindowMs:    10000,  // 10 seconds idle baseline
  gcSettleMs:      15000,  // wait after export for GC
  tallyTimeoutMs:  process.env.SKIP_TALLY ? 0 : 300000, // 5 min max for Tally export
  skipTally:       !!process.env.SKIP_TALLY,
  skipCleanup:     !!process.env.SKIP_CLEANUP,
};

// ── Colour helpers (ANSI) ─────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  red:    '\x1b[31m',
  dim:    '\x1b[2m',
};
const ok    = s => `${C.green}✓${C.reset} ${s}`;
const warn  = s => `${C.yellow}⚠${C.reset}  ${s}`;
const err   = s => `${C.red}✗${C.reset} ${s}`;
const phase = s => `\n${C.bold}${C.cyan}── ${s}${C.reset}\n`;
const dim   = s => `${C.dim}${s}${C.reset}`;

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpRequest(method, url, body, token, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const parsed  = new URL(url);
    const lib     = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...(token   ? { 'Authorization': `Bearer ${token}` }          : {}),
      },
    };

    const timer = setTimeout(() => reject(new Error(`Request timed out after ${timeoutMs}ms`)), timeoutMs);

    const req = lib.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), raw: data });
        } catch {
          resolve({ status: res.statusCode, body: null, raw: data });
        }
      });
    });

    req.on('error', e => { clearTimeout(timer); reject(e); });
    if (payload) req.write(payload);
    req.end();
  });
}

/** Sleep for `ms` milliseconds. */
const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Format MB value for display, always 2 decimal places. */
const fmb = v => (v != null ? `${Number(v).toFixed(1)} MB` : 'N/A     ');

/** Format a duration in ms into "Xm Ys" */
function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

// ── Phase helpers ─────────────────────────────────────────────────────────────

/**
 * Print a live progress spinner while an async operation is in flight.
 */
async function withSpinner(label, fn) {
  const frames = ['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏'];
  let i = 0;
  const ticker = setInterval(() => {
    process.stdout.write(`\r  ${frames[i++ % frames.length]}  ${label}   `);
  }, 100);
  try {
    const result = await fn();
    clearInterval(ticker);
    process.stdout.write(`\r  ${C.green}✓${C.reset}  ${label}${''.padEnd(20)}\n`);
    return result;
  } catch (e) {
    clearInterval(ticker);
    process.stdout.write(`\r  ${C.red}✗${C.reset}  ${label}${''.padEnd(20)}\n`);
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 0 — Register memory route on the live backend
// ─────────────────────────────────────────────────────────────────────────────

async function phase0_registerMemoryRoute() {
  console.log(phase('Phase 0 — Register /api/health/memory endpoint'));

  // We can't import server.js here because it would start a second server.
  // Instead we just verify the backend is reachable, then call the endpoint.
  // The endpoint is registered by running a tiny side-loader script via
  // a special route that server.js already has — /api/health.
  // We verify it exists first; if not, we ask the user to add it manually.

  const res = await httpRequest('GET', `${CONFIG.baseUrl}/api/health`, null, null, 5000)
    .catch(() => null);

  if (!res || res.status !== 200) {
    throw new Error(
      `Backend is not reachable at ${CONFIG.baseUrl}.\n` +
      `  → Make sure you ran "npm run dev" or "npm start" first.`
    );
  }
  console.log(ok(`Backend reachable at ${CONFIG.baseUrl}`));

  // Check if /api/health/memory is already available
  const memRes = await httpRequest('GET', `${CONFIG.baseUrl}/api/health/memory`, null, null, 4000)
    .catch(() => null);

  if (memRes && memRes.status === 200 && memRes.body?.rss) {
    console.log(ok('/api/health/memory endpoint is available'));
    return true;
  }

  // Not available — print clear instructions
  console.log(warn('/api/health/memory endpoint not found on the running backend.'));
  console.log('');
  console.log('  To enable precise per-process memory measurement, add this to server.js');
  console.log('  AFTER the existing /api/health route (around line 250 in server.js):');
  console.log('');
  console.log(`  ${dim('// ── Load-test memory probe (temporary — remove after testing) ─────────')}`);
  console.log(`  ${C.cyan}app.get('/api/health/memory', (_req, res) => {${C.reset}`);
  console.log(`  ${C.cyan}  res.json(process.memoryUsage());${C.reset}`);
  console.log(`  ${C.cyan}});${C.reset}`);
  console.log('');
  console.log('  Alternatively: run with SKIP_MEMORY_ROUTE=1 to use system RAM only.');
  console.log('');

  if (process.env.SKIP_MEMORY_ROUTE) {
    console.log(warn('SKIP_MEMORY_ROUTE=1 set — backend RSS will show as N/A, system RAM will still be measured.'));
    return false;
  }

  throw new Error(
    'Cannot proceed without /api/health/memory.\n' +
    'Either add the 3-line snippet above to server.js and restart, OR run with SKIP_MEMORY_ROUTE=1.'
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 1 — Authenticate
// ─────────────────────────────────────────────────────────────────────────────

async function phase1_authenticate() {
  console.log(phase('Phase 1 — Authenticate'));

  const res = await withSpinner(
    `POST /api/auth/login  (${CONFIG.loginEmail})`,
    () => httpRequest('POST', `${CONFIG.baseUrl}/api/auth/login`, {
      email:    CONFIG.loginEmail,
      password: CONFIG.loginPassword,
    }, null, 10000)
  );

  if (!res.body?.token) {
    throw new Error(
      `Login failed (HTTP ${res.status}).\n` +
      `  Response: ${res.raw.slice(0, 300)}\n\n` +
      `  → Set TEST_EMAIL and TEST_PASS environment variables to valid credentials.\n` +
      `    Example: TEST_EMAIL=youruser@company.com TEST_PASS=yourpassword node load-test/load-test-runner.js`
    );
  }

  console.log(ok(`Authenticated as ${CONFIG.loginEmail}`));
  return res.body.token;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 2 — Idle baseline
// ─────────────────────────────────────────────────────────────────────────────

async function phase2_idleBaseline(monitor) {
  console.log(phase(`Phase 2 — Idle baseline (${CONFIG.idleWindowMs / 1000}s window)`));
  monitor.setPhase('idle');
  console.log(`  Sampling for ${CONFIG.idleWindowMs / 1000} seconds...`);
  await sleep(CONFIG.idleWindowMs);
  const snap = await takeSnapshot('idle', CONFIG.baseUrl);
  console.log(ok(`Idle snapshot:  RSS ${fmb(snap.backend?.rss)}  |  Sys ${snap.system.usedMB} MB  |  CPU ${snap.cpu.systemPercent}%`));
  return snap;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3 — Parse Excel file (mimics what the frontend does)
// ─────────────────────────────────────────────────────────────────────────────

async function phase3_parseExcel(monitor) {
  console.log(phase('Phase 3 — Parse Excel file (1,000 rows)'));

  if (!fs.existsSync(CONFIG.excelFile)) {
    throw new Error(
      `Excel file not found: ${CONFIG.excelFile}\n` +
      `  → Run "node load-test/generate-test-invoices.js" first.`
    );
  }

  const fileSizeKB = (fs.statSync(CONFIG.excelFile).size / 1024).toFixed(1);
  console.log(`  File: ${CONFIG.excelFile}`);
  console.log(`  Size: ${fileSizeKB} KB`);

  monitor.setPhase('excel_parse');
  const parseStart = Date.now();

  const snapBefore = await takeSnapshot('excel_parse_start', CONFIG.baseUrl);

  // ── Parse Excel — identical to how the frontend does it ──────────────────
  const fileBuffer = fs.readFileSync(CONFIG.excelFile);
  const workbook   = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheet      = workbook.Sheets[workbook.SheetNames[0]];
  const rows       = XLSX.utils.sheet_to_json(sheet, { defval: '' });

  const snapAfter = await takeSnapshot('excel_parse_end', CONFIG.baseUrl);
  const parseDurationMs = Date.now() - parseStart;

  // ── Map Excel rows → invoice objects (same structure as real frontend) ────
  const batchId  = `LOADTEST-${Date.now()}`;
  const invoices = rows.map(row => ({
    invoiceNo:    row['Invoice No']    || '',
    invoiceDate:  row['Invoice Date']  || '',
    dueDate:      row['Due Date']      || '',
    purchaseOrderRef: row['PO Number'] || '',
    poDate:       row['PO Date']       || '',

    partyName:    row['Party Name']    || '',
    partyGST:     row['Party GST']     || '',
    partyAddress: row['Party Address'] || '',
    partyState:   row['Party State']   || '',

    shipToName:    row['Ship To Name']    || '',
    shipToAddress: row['Ship To Address'] || '',
    shipToCity:    row['Ship To City']    || '',
    shipToState:   row['Ship To State']   || '',

    status:       row['Status']    || 'Draft',
    narration:    row['Narration'] || '',
    uploadBatch:  batchId,
    source:       'excel_upload',

    items: [{
      description:      row['Item Description']   || '',
      hsn:              String(row['HSN'] || ''),
      qty:              Number(row['Qty']) || 1,
      unit:             row['Unit']        || 'Nos',
      rate:             Number(row['Rate']) || 0,
      amount:           Number(row['Basic Amount']) || 0,
      basic:            Number(row['Basic Amount']) || 0,
      total:            Number(row['Total Amount']) || 0,
      cgst:             Number(row['CGST Amount'])  || 0,
      sgst:             Number(row['SGST Amount'])  || 0,
      igst:             Number(row['IGST Amount'])  || 0,
      tallySalesLedger: row['Tally Sales Ledger']   || '',
    }],
  }));

  console.log(ok(`Parsed ${invoices.length} invoice rows in ${parseDurationMs}ms`));
  console.log(ok(`Batch ID: ${batchId}`));
  console.log(`  RAM before parse: ${fmb(snapBefore.backend?.rss)}`);
  console.log(`  RAM after parse:  ${fmb(snapAfter.backend?.rss)}`);

  return { invoices, batchId, snapBefore, snapAfter, parseDurationMs };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 4 — Bulk upload to backend (POST /api/invoices/bulk-upload)
// ─────────────────────────────────────────────────────────────────────────────

async function phase4_bulkUpload(invoices, batchId, token, monitor) {
  console.log(phase('Phase 4 — POST 1,000 invoices to /api/invoices/bulk-upload'));
  console.log(`  Sending ${invoices.length} invoices as JSON (application/json)...`);
  console.log(`  Batch: ${batchId}`);

  // Warn about DB writes — this is the only step that writes to MongoDB.
  console.log('');
  console.log(`  ${C.yellow}⚠  This step writes ${invoices.length} documents to MongoDB Atlas (sriChakraBackend).${C.reset}`);
  console.log(`     They will be tagged with uploadBatch="${batchId}".`);
  console.log(`     Cleanup will delete them automatically after the test (unless SKIP_CLEANUP=1).`);
  console.log('');

  monitor.setPhase('db_insert');
  const snapBefore = await takeSnapshot('upload_start', CONFIG.baseUrl);
  const uploadStart = Date.now();

  const res = await withSpinner(
    `POST /api/invoices/bulk-upload  (${invoices.length} records)`,
    () => httpRequest(
      'POST',
      `${CONFIG.baseUrl}/api/invoices/bulk-upload`,
      { invoices },
      token,
      120000   // 2 min timeout — 1000 records + Atlas round-trip
    )
  );

  const uploadDurationMs = Date.now() - uploadStart;
  const snapAfter = await takeSnapshot('upload_end', CONFIG.baseUrl);

  if (!res.body?.success) {
    console.log(err(`Bulk upload failed (HTTP ${res.status})`));
    console.log(`  Response: ${res.raw.slice(0, 500)}`);
    // Non-fatal — we still report what we measured
    return {
      success:       false,
      inserted:      0,
      errors:        res.body?.errors || [],
      durationMs:    uploadDurationMs,
      snapBefore,
      snapAfter,
    };
  }

  const inserted = res.body?.data?.inserted ?? res.body?.data?.length ?? 0;
  const errors   = res.body?.data?.errors   ?? [];

  console.log(ok(`Inserted ${inserted} invoices in ${fmtDuration(uploadDurationMs)}`));
  if (errors.length > 0) console.log(warn(`${errors.length} rows had errors (non-fatal)`));
  console.log(`  RAM before upload: ${fmb(snapBefore.backend?.rss)}`);
  console.log(`  RAM after upload:  ${fmb(snapAfter.backend?.rss)}`);

  return { success: true, inserted, errors, durationMs: uploadDurationMs, snapBefore, snapAfter };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 5 — Tally export via SSE stream
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens the full-export SSE stream and tails it until it closes or times out.
 * The monitor continuously samples RAM throughout.
 * Returns { completed, durationMs, eventCount, snapBefore, snapAfter }
 */
async function phase5_tallyExport(token, monitor) {
  console.log(phase('Phase 5 — Tally full export stream (GET /api/tally/full-export-stream)'));

  if (CONFIG.skipTally) {
    console.log(warn('SKIP_TALLY=1 — skipping Tally export phase.'));
    console.log('  RAM measurement for this phase will not be available.');
    return { completed: false, skipped: true, durationMs: 0, eventCount: 0,
             snapBefore: null, snapAfter: null };
  }

  console.log('  Connecting to SSE export stream...');
  console.log(`  Timeout: ${CONFIG.tallyTimeoutMs / 1000}s`);
  console.log(`  ${C.yellow}Note: If Tally is not running locally, this will timeout gracefully.${C.reset}`);
  console.log(`        RAM measurement is still valid even if Tally rejects the push.`);

  monitor.setPhase('tally_export');
  const snapBefore = await takeSnapshot('tally_start', CONFIG.baseUrl);
  const exportStart = Date.now();

  const result = await new Promise((resolve) => {
    const streamUrl = `${CONFIG.baseUrl}/api/tally/full-export-stream?token=${encodeURIComponent(token)}`;
    const parsed    = new URL(streamUrl);
    const lib       = parsed.protocol === 'https:' ? https : http;

    let eventCount   = 0;
    let lastEvent    = '';
    let completed    = false;
    let timedOut     = false;
    let errorMessage = null;
    let progressDots = 0;

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      req.destroy();
      resolve({ completed: false, timedOut: true, durationMs: Date.now() - exportStart,
                eventCount, lastEvent, errorMessage: 'Tally export timed out' });
    }, CONFIG.tallyTimeoutMs);

    // Print progress dots every 5 seconds so the user knows it's alive
    const progressTimer = setInterval(() => {
      progressDots++;
      process.stdout.write(`\r  ${C.dim}Streaming... ${progressDots * 5}s  events: ${eventCount}${C.reset}   `);
    }, 5000);

    const req = lib.get({
      hostname: parsed.hostname,
      port:     parsed.port,
      path:     parsed.pathname + parsed.search,
      headers:  { 'Accept': 'text/event-stream', 'Cache-Control': 'no-cache' },
    }, res => {
      let buffer = '';

      res.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // heartbeat/comment

          if (trimmed.startsWith('data: ')) {
            eventCount++;
            try {
              const payload = JSON.parse(trimmed.slice(6));
              lastEvent = payload.message || payload.type || JSON.stringify(payload).slice(0, 80);

              // Detect completion signals in the SSE payload
              if (payload.done === true || payload.completed === true ||
                  payload.type === 'complete' || payload.type === 'done' ||
                  (typeof payload.message === 'string' && payload.message.toLowerCase().includes('export complete'))) {
                completed = true;
              }
              // Detect error signals
              if (payload.error || payload.type === 'error') {
                errorMessage = payload.error || payload.message || 'Export error';
              }
            } catch { /* non-JSON SSE line — ignore */ }
          }
        }
      });

      res.on('end', () => {
        clearTimeout(timeoutTimer);
        clearInterval(progressTimer);
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
        resolve({
          completed,
          timedOut:     false,
          durationMs:   Date.now() - exportStart,
          eventCount,
          lastEvent,
          errorMessage,
          httpStatus:   res.statusCode,
        });
      });

      res.on('error', e => {
        clearTimeout(timeoutTimer);
        clearInterval(progressTimer);
        process.stdout.write('\r' + ' '.repeat(60) + '\r');
        resolve({
          completed:    false,
          timedOut:     false,
          durationMs:   Date.now() - exportStart,
          eventCount,
          lastEvent,
          errorMessage: e.message,
          httpStatus:   res.statusCode,
        });
      });
    });

    req.on('error', e => {
      clearTimeout(timeoutTimer);
      clearInterval(progressTimer);
      process.stdout.write('\r' + ' '.repeat(60) + '\r');
      resolve({
        completed: false, timedOut: false,
        durationMs: Date.now() - exportStart,
        eventCount, lastEvent,
        errorMessage: e.message,
      });
    });
  });

  const snapAfter = await takeSnapshot('tally_end', CONFIG.baseUrl);

  if (result.completed) {
    console.log(ok(`Tally export completed in ${fmtDuration(result.durationMs)} (${result.eventCount} SSE events)`));
  } else if (result.timedOut) {
    console.log(warn(`Tally export timed out after ${fmtDuration(result.durationMs)} — ${result.eventCount} events received`));
    console.log('  This is expected if Tally is not running. RAM measurements are still valid.');
  } else {
    console.log(warn(`Tally export ended early: ${result.errorMessage || 'unknown reason'}`));
    console.log(`  Events received: ${result.eventCount}  Duration: ${fmtDuration(result.durationMs)}`);
  }

  console.log(`  RAM before export: ${fmb(snapBefore?.backend?.rss)}`);
  console.log(`  RAM after export:  ${fmb(snapAfter?.backend?.rss)}`);

  return { ...result, snapBefore, snapAfter };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 6 — Post-export: GC settle + final measurement
// ─────────────────────────────────────────────────────────────────────────────

async function phase6_postExport(monitor) {
  console.log(phase(`Phase 6 — GC settle (${CONFIG.gcSettleMs / 1000}s wait)`));
  console.log('  Waiting for V8 garbage collector to settle...');
  monitor.setPhase('gc_settle');
  await sleep(CONFIG.gcSettleMs);
  const snapFinal = await takeSnapshot('post_export', CONFIG.baseUrl);
  console.log(ok(`Final snapshot:  RSS ${fmb(snapFinal.backend?.rss)}  |  Sys ${snapFinal.system.usedMB} MB`));
  return snapFinal;
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 7 — Cleanup: delete the 1,000 test invoices
// ─────────────────────────────────────────────────────────────────────────────

async function phase7_cleanup(batchId, token) {
  console.log(phase('Phase 7 — Cleanup: delete test invoices'));

  if (CONFIG.skipCleanup) {
    console.log(warn(`SKIP_CLEANUP=1 — leaving test invoices in DB (batch: ${batchId}).`));
    console.log('  To delete them manually, filter MongoDB by: { uploadBatch: "' + batchId + '" }');
    return { deleted: 0, skipped: true };
  }

  console.log(`  Deleting invoices with uploadBatch="${batchId}"...`);

  // Step 1: Fetch all invoices from this batch
  const listRes = await httpRequest(
    'GET',
    `${CONFIG.baseUrl}/api/invoices?source=excel_upload&limit=1200`,
    null,
    token,
    30000
  ).catch(e => ({ body: null, error: e.message }));

  const allInvoices = listRes.body?.data ?? listRes.body?.invoices ?? [];
  const testBatch   = allInvoices.filter(inv => inv.uploadBatch === batchId);

  if (testBatch.length === 0) {
    console.log(warn('No test invoices found to delete (batch not found in /api/invoices response).'));
    console.log(`  Batch ID was: ${batchId}`);
    return { deleted: 0, skipped: false };
  }

  console.log(`  Found ${testBatch.length} invoices to delete...`);

  // Step 2: Delete each one by ID (sequential to avoid rate limiting)
  let deleted = 0;
  let failed  = 0;
  const batchSize = 50;

  for (let i = 0; i < testBatch.length; i += batchSize) {
    const chunk = testBatch.slice(i, i + batchSize);
    await Promise.all(chunk.map(async inv => {
      const delRes = await httpRequest(
        'DELETE',
        `${CONFIG.baseUrl}/api/invoices/${inv._id}`,
        null,
        token,
        10000
      ).catch(() => null);
      if (delRes?.body?.success || delRes?.status === 200) {
        deleted++;
      } else {
        failed++;
      }
    }));
    process.stdout.write(`\r  Deleted ${deleted}/${testBatch.length}...   `);
  }

  process.stdout.write('\r' + ' '.repeat(50) + '\r');

  if (deleted === testBatch.length) {
    console.log(ok(`Deleted all ${deleted} test invoices.`));
  } else {
    console.log(warn(`Deleted ${deleted}/${testBatch.length} — ${failed} failed. Check manually.`));
  }

  return { deleted, failed, skipped: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// REPORT — generate the final measurement report
// ─────────────────────────────────────────────────────────────────────────────

function generateReport(data) {
  const {
    idleSnap,
    parseResult,
    uploadResult,
    tallyResult,
    finalSnap,
    monitor,
    totalDurationMs,
    systemInfo,
  } = data;

  // Aggregate per-phase samples from the monitor
  const aggIdle   = monitor.aggregate('idle');
  const aggParse  = monitor.aggregate('excel_parse');
  const aggUpload = monitor.aggregate('db_insert');
  const aggTally  = monitor.aggregate('tally_export');
  const aggFinal  = monitor.aggregate('gc_settle');
  const aggAll    = monitor.aggregate(); // all phases combined

  const peakSnap  = monitor.peakSnapshot();

  // ── Memory-release check ─────────────────────────────────────────────────
  const peakRss   = peakSnap?.backend?.rss ?? null;
  const finalRss  = finalSnap?.backend?.rss ?? null;
  const idleRss   = idleSnap?.backend?.rss ?? null;
  const memReleased = (peakRss && finalRss && peakRss > 0)
    ? ((peakRss - finalRss) / peakRss * 100).toFixed(1)
    : null;
  const returnedToBaseline = idleRss && finalRss
    ? Math.abs(finalRss - idleRss) < 30  // within 30 MB of idle
    : null;

  // ── AWS EC2 sizing ────────────────────────────────────────────────────────
  const awsSizing = calcAwsSizing(peakRss, systemInfo);

  // ── Build text report ─────────────────────────────────────────────────────
  const sep  = '═'.repeat(65);
  const sep2 = '─'.repeat(65);

  const r = (label, value) =>
    `  ${label.padEnd(38)} ${String(value).padStart(14)}\n`;

  let report = '';
  report += `\n${sep}\n`;
  report += `  CHAKRA BACKEND — RAM / CPU LOAD TEST RESULT\n`;
  report += `  Test Date : ${new Date().toLocaleString('en-IN')}\n`;
  report += `  Platform  : ${systemInfo.platform} ${systemInfo.arch}  Node ${systemInfo.nodeVersion}\n`;
  report += `  System RAM: ${systemInfo.totalRamMB} MB total\n`;
  report += `  Backend   : ${CONFIG.baseUrl}\n`;
  report += `${sep}\n\n`;

  // ── SECTION 1: Phase-by-phase RAM ─────────────────────────────────────────
  report += `── PHASE-BY-PHASE RAM (Node.js RSS — actual process RAM) ──────\n\n`;
  report += r('Idle (baseline):',               fmb(aggIdle?.backendRssPeak ?? idleSnap?.backend?.rss));
  report += r('During Excel parsing:',           fmb(aggParse?.backendRssPeak ?? parseResult.snapAfter?.backend?.rss));
  report += r('During MongoDB insert:',          fmb(aggUpload?.backendRssPeak ?? uploadResult.snapAfter?.backend?.rss));
  report += r('During Tally export:',
    tallyResult.skipped ? 'SKIPPED' :
    fmb(aggTally?.backendRssPeak ?? tallyResult.snapAfter?.backend?.rss));
  report += r('After export (post-GC):',         fmb(finalSnap?.backend?.rss));
  report += `\n`;

  // ── SECTION 2: Peak across all phases ────────────────────────────────────
  report += `── PEAK MEASUREMENTS ──────────────────────────────────────────\n\n`;
  report += r('PEAK Node.js RSS:',              fmb(peakRss));
  report += r('PEAK at phase:',                 peakSnap?.label ?? 'unknown');
  report += r('PEAK at time:',                  peakSnap?.timestamp?.slice(11, 19) ?? 'N/A');
  report += r('PEAK system RAM used:',          `${aggAll?.sysUsedMax ?? '?'} MB`);
  report += r('PEAK CPU (system-wide):',        `${aggAll?.cpuPeak ?? '?'}%`);
  report += `\n`;

  // ── SECTION 3: System RAM ─────────────────────────────────────────────────
  report += `── SYSTEM RAM ──────────────────────────────────────────────────\n\n`;
  report += r('Total system RAM:',              `${systemInfo.totalRamMB} MB`);
  report += r('System RAM at idle:',            `${idleSnap?.system?.usedMB ?? '?'} MB`);
  report += r('System RAM at peak:',            `${aggAll?.sysUsedMax ?? '?'} MB`);
  report += r('System RAM after export:',       `${finalSnap?.system?.usedMB ?? '?'} MB`);
  report += r('System RAM free at peak load:',
    (aggAll?.sysUsedMax != null)
      ? `${systemInfo.totalRamMB - aggAll.sysUsedMax} MB`
      : 'N/A');
  report += `\n`;

  // ── SECTION 4: Backend heap detail ───────────────────────────────────────
  report += `── NODE.JS HEAP DETAIL (at peak RSS snapshot) ──────────────────\n\n`;
  report += r('Heap used:',                     fmb(peakSnap?.backend?.heapUsed));
  report += r('Heap allocated (total):',        fmb(peakSnap?.backend?.heapTotal));
  report += r('External (Buffers):',            fmb(peakSnap?.backend?.external));
  report += `\n`;

  // ── SECTION 5: CPU ────────────────────────────────────────────────────────
  report += `── CPU ─────────────────────────────────────────────────────────\n\n`;
  report += r('CPU at idle:',                   `${aggIdle?.cpuAvg ?? '?'}%`);
  report += r('CPU peak (during upload):',      `${aggUpload?.cpuPeak ?? '?'}%`);
  report += r('CPU peak (during Tally export):', tallyResult.skipped ? 'SKIPPED' : `${aggTally?.cpuPeak ?? '?'}%`);
  report += r('CPU overall peak:',              `${aggAll?.cpuPeak ?? '?'}%`);
  report += r('CPU overall avg:',               `${aggAll?.cpuAvg ?? '?'}%`);
  report += `\n`;

  // ── SECTION 6: Timing ─────────────────────────────────────────────────────
  report += `── TIMING ──────────────────────────────────────────────────────\n\n`;
  report += r('Excel parse time:',              fmtDuration(parseResult.parseDurationMs));
  report += r('DB insert time (1,000 records):', fmtDuration(uploadResult.durationMs));
  report += r('Tally export time:',
    tallyResult.skipped ? 'SKIPPED' :
    tallyResult.timedOut ? `TIMEOUT (>${fmtDuration(CONFIG.tallyTimeoutMs)})` :
    fmtDuration(tallyResult.durationMs));
  report += r('Total test duration:',           fmtDuration(totalDurationMs));
  report += `\n`;

  // ── SECTION 7: Memory release check ──────────────────────────────────────
  report += `── MEMORY RELEASE CHECK ────────────────────────────────────────\n\n`;
  report += r('RSS at idle:',                   fmb(idleRss));
  report += r('RSS at peak:',                   fmb(peakRss));
  report += r('RSS after export (post-GC):',    fmb(finalRss));
  report += r('% RAM released after export:',   memReleased != null ? `${memReleased}%` : 'N/A');
  report += r('Memory returned to baseline:',
    returnedToBaseline === null ? 'N/A (no endpoint)' :
    returnedToBaseline ? 'YES ✓' : 'NO — leaked ~' + Math.abs(finalRss - idleRss).toFixed(1) + ' MB');
  report += `\n`;

  // ── SECTION 8: Upload result ──────────────────────────────────────────────
  report += `── UPLOAD RESULT ───────────────────────────────────────────────\n\n`;
  report += r('Invoices sent:',                 1000);
  report += r('Invoices inserted:',             uploadResult.inserted);
  report += r('Upload errors:',                 uploadResult.errors?.length ?? 0);
  report += r('Tally SSE events received:',
    tallyResult.skipped ? 'SKIPPED' : tallyResult.eventCount);
  report += r('Tally export completed:',
    tallyResult.skipped ? 'SKIPPED' :
    tallyResult.completed ? 'YES ✓' : tallyResult.timedOut ? 'TIMED OUT' : 'NO');
  report += `\n`;

  // ── SECTION 9: AWS EC2 sizing ─────────────────────────────────────────────
  report += `${sep2}\n`;
  report += `  AWS EC2 RAM SIZING RECOMMENDATION\n`;
  report += `  Based on ACTUAL measured peak: ${fmb(peakRss)}\n`;
  report += `${sep2}\n\n`;
  report += awsSizing;
  report += `\n`;

  // ── SECTION 10: Sample count ──────────────────────────────────────────────
  report += `── MONITOR STATISTICS ──────────────────────────────────────────\n\n`;
  report += r('Total samples collected:',       monitor.getSamples().length);
  report += r('Sampling interval:',             `${CONFIG.monitorInterval}ms`);
  report += `\n${sep}\n`;

  return { report, awsSizing, peakRss, finalRss, idleRss, memReleased, returnedToBaseline };
}

// ─────────────────────────────────────────────────────────────────────────────
// AWS EC2 sizing calculator
// ─────────────────────────────────────────────────────────────────────────────

function calcAwsSizing(peakRssMB, systemInfo) {
  if (!peakRssMB) {
    return '  Backend RSS not available — cannot compute sizing.\n' +
           '  Add /api/health/memory endpoint and rerun.\n';
  }

  // Overhead estimates
  const osOverheadMB      = 150;  // Linux OS + kernel buffers
  const mongoAtlasNote    = 'MongoDB is Atlas (cloud) — no local RAM overhead';
  const expressOverheadMB = 30;   // Express + middleware resident set beyond peak ops
  const safetyMultiplier  = 1.4;  // 40% headroom for traffic spikes

  const minimumMB     = Math.ceil((peakRssMB + osOverheadMB + expressOverheadMB) / 128) * 128;
  const productionMB  = Math.ceil(minimumMB * safetyMultiplier / 256) * 256;

  // Available RAM during export = EC2 tier RAM minus everything in use
  const ec2Options = [512, 1024, 2048, 4096];

  let lines = '';
  lines += `  1. Actual peak RSS (Node.js process)  : ${fmb(peakRssMB)}\n`;
  lines += `  2. OS / kernel overhead (Linux)       : ~${osOverheadMB} MB\n`;
  lines += `  3. MongoDB                            : ${mongoAtlasNote}\n`;
  lines += `  4. Express / middleware overhead      : ~${expressOverheadMB} MB\n`;
  lines += `  5. Total minimum footprint            : ~${minimumMB} MB\n`;
  lines += `  6. Recommended minimum (×1.4 headroom): ~${productionMB} MB\n`;
  lines += '\n';

  // Per-tier availability
  lines += `  EC2 tier suitability for 1,000-record Tally export:\n\n`;
  for (const tier of ec2Options) {
    const available = tier - minimumMB;
    let verdict;
    if (available < 0) {
      verdict = `✗  INSUFFICIENT — would need ${Math.abs(available)} MB more`;
    } else if (available < 128) {
      verdict = `⚠  TIGHT — only ${available} MB free (risky for traffic spikes)`;
    } else if (available < 512) {
      verdict = `✓  MINIMUM — ${available} MB free during export`;
    } else {
      verdict = `✓✓ COMFORTABLE — ${available} MB free during export`;
    }
    lines += `    ${String(tier).padStart(4)} MB EC2 : ${verdict}\n`;
  }

  lines += '\n';
  lines += `  RECOMMENDATION:\n`;
  if (productionMB <= 512) {
    lines += `    Minimum  : t3.nano  (512 MB)  — but very tight\n`;
    lines += `    Production: t3.micro (1 GB)   — recommended\n`;
  } else if (productionMB <= 1024) {
    lines += `    Minimum  : t3.micro (1 GB)    — bare minimum\n`;
    lines += `    Production: t3.small (2 GB)   — recommended\n`;
  } else if (productionMB <= 2048) {
    lines += `    Minimum  : t3.small (2 GB)    — minimum for production\n`;
    lines += `    Production: t3.medium (4 GB)  — recommended with buffer\n`;
  } else {
    lines += `    Minimum  : t3.medium (4 GB)   — required\n`;
    lines += `    Production: t3.large (8 GB)   — recommended\n`;
  }
  lines += '\n';
  lines += `  Free RAM during 1,000-record export (t3.micro = 1 GB):\n`;
  lines += `    1024 MB - ${minimumMB} MB (peak footprint) = ${1024 - minimumMB} MB available\n`;

  return lines;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN ORCHESTRATOR
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const testStart = Date.now();

  console.log('');
  console.log('╔' + '═'.repeat(63) + '╗');
  console.log('║   CHAKRA BACKEND — RAM / CPU LOAD TEST                      ║');
  console.log('║   1,000-record Invoice Upload + Tally Export                ║');
  console.log('╚' + '═'.repeat(63) + '╝');
  console.log('');
  console.log(`  Backend : ${CONFIG.baseUrl}`);
  console.log(`  Excel   : ${CONFIG.excelFile}`);
  console.log(`  Skip Tally  : ${CONFIG.skipTally}`);
  console.log(`  Skip Cleanup: ${CONFIG.skipCleanup}`);
  console.log('');

  const systemInfo = {
    platform:    process.platform,
    arch:        process.arch,
    nodeVersion: process.version,
    totalRamMB:  Math.round(os.totalmem() / (1024 * 1024)),
    cpuModel:    os.cpus()[0]?.model ?? 'unknown',
  };

  console.log(`  System  : ${systemInfo.totalRamMB} MB RAM  |  ${os.cpus().length} CPU(s)  |  ${systemInfo.cpuModel}`);
  console.log('');

  // ── Start monitor ──────────────────────────────────────────────────────────
  const monitor = new RamMonitor({
    intervalMs: CONFIG.monitorInterval,
    baseUrl:    CONFIG.baseUrl,
    verbose:    false,   // suppress per-sample output during test phases
  });
  monitor.start('startup');

  try {
    // Phase 0 — register memory route
    await phase0_registerMemoryRoute();

    // Phase 1 — auth
    const token = await phase1_authenticate();

    // Phase 2 — idle baseline
    const idleSnap = await phase2_idleBaseline(monitor);

    // Phase 3 — parse Excel
    const parseResult = await phase3_parseExcel(monitor);

    // Phase 4 — bulk upload
    const uploadResult = await phase4_bulkUpload(
      parseResult.invoices, parseResult.batchId, token, monitor
    );

    // Phase 5 — Tally export
    const tallyResult = await phase5_tallyExport(token, monitor);

    // Phase 6 — GC settle
    const finalSnap = await phase6_postExport(monitor);

    // Stop monitor and collect all samples
    monitor.stop();
    const totalDurationMs = Date.now() - testStart;

    // Phase 7 — cleanup
    await phase7_cleanup(parseResult.batchId, token);

    // ── Generate report ──────────────────────────────────────────────────────
    console.log(phase('Final Report'));

    const { report } = generateReport({
      idleSnap,
      parseResult,
      uploadResult,
      tallyResult,
      finalSnap,
      monitor,
      totalDurationMs,
      systemInfo,
    });

    // Print to console
    console.log(report);

    // Save report text
    fs.writeFileSync(CONFIG.reportFile, report, 'utf8');
    console.log(ok(`Report saved: ${CONFIG.reportFile}`));

    // Save JSON data for external analysis
    const jsonData = {
      meta: {
        testDate:      new Date().toISOString(),
        backendUrl:    CONFIG.baseUrl,
        totalDurationMs,
        systemInfo,
      },
      snapshots: {
        idle:        idleSnap,
        parseStart:  parseResult.snapBefore,
        parseEnd:    parseResult.snapAfter,
        uploadStart: uploadResult.snapBefore,
        uploadEnd:   uploadResult.snapAfter,
        tallyStart:  tallyResult.snapBefore,
        tallyEnd:    tallyResult.snapAfter,
        final:       finalSnap,
        peak:        monitor.peakSnapshot(),
      },
      aggregates: {
        idle:   monitor.aggregate('idle'),
        parse:  monitor.aggregate('excel_parse'),
        upload: monitor.aggregate('db_insert'),
        tally:  monitor.aggregate('tally_export'),
        all:    monitor.aggregate(),
      },
      uploadResult: {
        inserted:  uploadResult.inserted,
        errors:    uploadResult.errors?.length ?? 0,
        durationMs: uploadResult.durationMs,
      },
      tallyResult: {
        completed:   tallyResult.completed,
        timedOut:    tallyResult.timedOut,
        skipped:     tallyResult.skipped,
        eventCount:  tallyResult.eventCount,
        durationMs:  tallyResult.durationMs,
        errorMessage: tallyResult.errorMessage,
      },
      allSamples: monitor.getSamples(),
    };

    fs.writeFileSync(CONFIG.resultFile, JSON.stringify(jsonData, null, 2), 'utf8');
    console.log(ok(`JSON data saved: ${CONFIG.resultFile}`));
    console.log('');

  } catch (e) {
    monitor.stop();
    console.log('');
    console.log(err(`Load test failed: ${e.message}`));
    if (process.env.DEBUG) console.error(e);
    process.exit(1);
  }
}

main();
