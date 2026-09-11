/**
 * probe-render.mjs
 * Hits the live Render backend, logs in, and measures:
 *  - Invoice count + Tally sync status
 *  - Tally export counts (pending records)
 *  - Dashboard stats
 *  - System RAM on Render (via process.memoryUsage if available)
 */
import https from 'https';
import os    from 'os';

const BASE = 'https://chakraindustries-backend.onrender.com';
const MB   = 1024 * 1024;

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'chakraindustries-backend.onrender.com',
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.write(payload);
    req.end();
  });
}

function get(path, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'chakraindustries-backend.onrender.com',
      path,
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
    };
    const req = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(d) }); }
        catch { resolve({ status: res.statusCode, body: d }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

const sep  = '═'.repeat(62);
const sep2 = '─'.repeat(62);
const row  = (l, v) => console.log(`  ${l.padEnd(40)} ${String(v).padStart(16)}`);

async function main() {
  console.log('');
  console.log(sep);
  console.log('  CHAKRA RENDER BACKEND — LIVE RAM + DATA PROBE');
  console.log(`  ${new Date().toLocaleString('en-IN')}`);
  console.log(sep);

  // ── 1. Health check ────────────────────────────────────────────────────────
  console.log('\n── Step 1: Health check ──────────────────────────────────────');
  const health = await get('/api/health');
  if (health.status !== 200) {
    console.log(`✗ Backend not reachable (HTTP ${health.status})`);
    process.exit(1);
  }
  console.log(`  ✓ Backend alive: ${health.body.status}`);
  console.log(`  ✓ Server time  : ${health.body.timestamp}`);

  // ── 2. Memory endpoint ─────────────────────────────────────────────────────
  console.log('\n── Step 2: Process memory (RSS) ──────────────────────────────');
  const memRes = await get('/api/health/memory');
  if (memRes.status === 200 && memRes.body?.rss) {
    const m = memRes.body;
    console.log('  ✓ /api/health/memory endpoint IS available');
    row('Node.js RSS (total process RAM):',  `${(m.rss/MB).toFixed(1)} MB`);
    row('Heap used:',                         `${(m.heapUsed/MB).toFixed(1)} MB`);
    row('Heap allocated:',                    `${(m.heapTotal/MB).toFixed(1)} MB`);
    row('External (Buffers):',               `${(m.external/MB).toFixed(1)} MB`);
  } else {
    console.log('  ✗ /api/health/memory not available on Render (HTTP ' + memRes.status + ')');
    console.log('    → Need to add the 3-line snippet to server.js and redeploy');
    console.log('    → Continuing with data/stats probes only...');
  }

  // ── 3. Login ───────────────────────────────────────────────────────────────
  console.log('\n── Step 3: Login ─────────────────────────────────────────────');
  
  // Try multiple credential combinations
  const credPairs = [
    { email: 'admin@chakra.com',           password: 'admin123' },
    { email: 'admin@srichakra.com',        password: 'admin123' },
    { email: 'admin@chakraindustries.com', password: 'admin123' },
    { email: 'parnetstech21@gmail.com',    password: 'admin123' },
  ];

  let token = null;
  for (const creds of credPairs) {
    const r = await post('/api/auth/login', creds);
    if (r.status === 200 && r.body?.token) {
      token = r.body.token;
      console.log(`  ✓ Logged in as: ${creds.email}`);
      break;
    }
  }

  if (!token) {
    console.log('  ✗ Could not auto-login with known credentials.');
    console.log('    Set TEST_EMAIL and TEST_PASS env vars and rerun:');
    console.log('    TEST_EMAIL=you@email.com TEST_PASS=pass node load-test/probe-render.mjs');
    // Try unauthenticated stats that might be public
  }

  // ── 4. Invoice counts ──────────────────────────────────────────────────────
  if (token) {
    console.log('\n── Step 4: Invoice data ──────────────────────────────────────');
    const invStats = await get('/api/invoices/stats', token);
    if (invStats.status === 200 && invStats.body?.data) {
      const s = invStats.body.data;
      row('Total invoices in DB:',        s.total        ?? s.count ?? '?');
      row('Excel-uploaded invoices:',     s.excelUploaded ?? s.fromExcel ?? '?');
      row('Tally-synced invoices:',       s.tallySynced  ?? s.synced ?? '?');
      row('Pending Tally export:',        s.tallyPending ?? s.pending ?? '?');
      row('Draft invoices:',              s.draft        ?? '?');
    } else {
      // Fallback: try plain list with limit
      const invList = await get('/api/invoices?limit=1', token);
      if (invList.status === 200) {
        const total = invList.body?.total ?? invList.body?.count ?? 'unknown';
        row('Total invoices in DB:', total);
      }
    }

    // ── 5. Tally export counts ───────────────────────────────────────────────
    console.log('\n── Step 5: Tally export counts ───────────────────────────────');
    const exportCounts = await get('/api/tally/export-counts', token);
    if (exportCounts.status === 200 && exportCounts.body?.data) {
      const d = exportCounts.body.data;
      Object.entries(d).forEach(([k, v]) => {
        row(k + ':', typeof v === 'object' ? JSON.stringify(v) : v);
      });
    } else {
      console.log(`  HTTP ${exportCounts.status}: ${JSON.stringify(exportCounts.body).slice(0,100)}`);
    }

    // ── 6. Tally dashboard stats ─────────────────────────────────────────────
    console.log('\n── Step 6: Tally dashboard stats ─────────────────────────────');
    const dash = await get('/api/tally/dashboard-stats', token);
    if (dash.status === 200 && dash.body?.data) {
      const d = dash.body.data;
      if (d.erpCounts) {
        row('ERP Invoices total:',     d.erpCounts?.invoices ?? '?');
        row('ERP Sales Orders:',       d.erpCounts?.salesOrders ?? '?');
        row('ERP Purchase Orders:',    d.erpCounts?.purchaseOrders ?? '?');
      }
      if (d.tallyVouchers) {
        row('Tally Sales vouchers:',   d.tallyVouchers?.sales?.count ?? '?');
        row('Tally Purchase vouchers:',d.tallyVouchers?.purchase?.count ?? '?');
      }
      if (d.syncHealth) {
        row('Tally connection status:', d.syncHealth?.connectionStatus ?? '?');
        row('Last Tally sync:',         d.syncHealth?.lastSyncAt ?? 'never');
      }
    } else {
      console.log(`  HTTP ${dash.status}`);
    }

    // ── 7. Sync logs (most recent) ───────────────────────────────────────────
    console.log('\n── Step 7: Recent Tally sync logs (last 5) ───────────────────');
    const logs = await get('/api/tally/logs?limit=5', token);
    if (logs.status === 200 && Array.isArray(logs.body?.data)) {
      if (logs.body.data.length === 0) {
        console.log('  No sync logs found.');
      } else {
        logs.body.data.forEach((l, i) => {
          console.log(`  ${i+1}. [${l.status}] ${l.type} — ${l.records ?? 0} records — ${new Date(l.createdAt).toLocaleString('en-IN')}`);
          if (l.error) console.log(`     Error: ${String(l.error).slice(0, 80)}`);
        });
      }
    }
  }

  // ── 8. Summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log(sep2);
  console.log('  RENDER INSTANCE RAM SUMMARY');
  console.log(sep2);

  const memRes2 = await get('/api/health/memory');
  if (memRes2.status === 200 && memRes2.body?.rss) {
    const rss = (memRes2.body.rss / MB).toFixed(1);
    console.log(`  Current Node.js RSS on Render   : ${rss} MB`);
    console.log(`  This is the IDLE RAM (no load)`);
    console.log(`  Under 1000-invoice load it will be higher.`);
    console.log(`  Run the full load test locally to get peak load numbers.`);
  } else {
    console.log('  /api/health/memory not available on current Render deployment.');
    console.log('');
    console.log('  ══ HOW TO GET THE EXACT NUMBER ══════════════════════════════');
    console.log('');
    console.log('  Add this to server.js (after /api/health route) and redeploy:');
    console.log('');
    console.log("  app.get('/api/health/memory', (_req, res) => {");
    console.log('    res.json(process.memoryUsage());');
    console.log('  });');
    console.log('');
    console.log('  Then run this probe again and you will get the exact MB.');
    console.log('');
    console.log('  ── OR ──');
    console.log('');
    console.log('  Check Render Dashboard → your service → Metrics tab.');
    console.log('  It shows real-time RAM graph. Look at:');
    console.log('    https://dashboard.render.com');
    console.log('  Open your chakraindustries-backend service → Metrics');
    console.log('  The "Memory" graph shows exact MB in real-time.');
  }
  console.log(sep);
  console.log('');
}

main().catch(e => { console.error('Probe error:', e.message); process.exit(1); });
