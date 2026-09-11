/**
 * ram-monitor.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Continuously polls RAM and CPU of:
 *   1. The Chakra backend Node.js process (via /api/health + process.memoryUsage
 *      endpoint we expose through a thin monitoring endpoint)
 *   2. System-wide RAM (via os module — works without any native bindings)
 *   3. Node.js process CPU% (derived from /proc/stat or Windows WMIC via child_process)
 *
 * This module is imported and driven by load-test-runner.js.
 * It can also be run standalone:
 *   node load-test/ram-monitor.js
 *
 * SAFE: Read-only. No writes to DB, no application code changes.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import os             from 'os';
import { execSync }   from 'child_process';
import http           from 'http';
import https          from 'https';

// ── Constants ─────────────────────────────────────────────────────────────────
const MB = 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// CPU sampler — works on Windows (WMIC) and Linux (/proc/stat)
// Returns the backend Node.js process CPU% since the last call.
// Falls back to 0 if measurement is unavailable.
// ─────────────────────────────────────────────────────────────────────────────

// Tracks the previous CPU time snapshot for delta calculation (Linux only)
let _prevCpuTimes = null;

/**
 * Get overall system CPU usage % (all cores, averaged).
 * Uses WMIC on Windows, /proc/stat on Linux.
 */
export function getSystemCpuPercent() {
  try {
    if (process.platform === 'win32') {
      // WMIC returns LoadPercentage for each CPU; we average them
      const out = execSync(
        'wmic cpu get LoadPercentage /value',
        { timeout: 3000, stdio: ['pipe','pipe','pipe'] }
      ).toString();
      const matches = [...out.matchAll(/LoadPercentage=(\d+)/gi)];
      if (matches.length === 0) return 0;
      const avg = matches.reduce((s, m) => s + parseInt(m[1]), 0) / matches.length;
      return Math.round(avg * 10) / 10;
    } else {
      // Linux: read /proc/stat for aggregate CPU line
      const stat = execSync('cat /proc/stat', { timeout: 2000 }).toString();
      const line = stat.split('\n')[0]; // "cpu  user nice system idle ..."
      const vals = line.trim().split(/\s+/).slice(1).map(Number);
      const idle  = vals[3] + (vals[4] || 0); // idle + iowait
      const total = vals.reduce((a, b) => a + b, 0);

      if (_prevCpuTimes) {
        const dIdle  = idle  - _prevCpuTimes.idle;
        const dTotal = total - _prevCpuTimes.total;
        _prevCpuTimes = { idle, total };
        return dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 1000) / 10 : 0;
      }
      _prevCpuTimes = { idle, total };
      return 0;
    }
  } catch {
    return 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Backend process memory — polled from the backend's /api/health/memory
// endpoint that we inject via a lightweight route registered in monitor-patch.js.
// If that endpoint is unavailable, we fall back to zero (the runner handles this).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fetch a URL and return the response body as a string.
 * Times out after `timeoutMs` ms.
 */
function fetchUrl(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const lib   = url.startsWith('https') ? https : http;
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    lib.get(url, { headers: { 'Accept': 'application/json' } }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end',  () => { clearTimeout(timer); resolve(body); });
    }).on('error', e => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Poll the backend memory endpoint.
 * Returns { rss, heapUsed, heapTotal, external } all in MB, or null on failure.
 */
export async function getBackendMemoryMB(baseUrl = 'http://localhost:5000') {
  try {
    const body = await fetchUrl(`${baseUrl}/api/health/memory`, 4000);
    const data = JSON.parse(body);
    if (!data || !data.rss) return null;
    return {
      rss:       Math.round(data.rss       / MB * 10) / 10,
      heapUsed:  Math.round(data.heapUsed  / MB * 10) / 10,
      heapTotal: Math.round(data.heapTotal / MB * 10) / 10,
      external:  Math.round(data.external  / MB * 10) / 10,
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// System RAM — via Node.js `os` module (no native binding needed)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns current system-wide RAM stats in MB.
 */
export function getSystemRamMB() {
  const total = os.totalmem();
  const free  = os.freemem();
  const used  = total - free;
  return {
    totalMB:     Math.round(total / MB),
    usedMB:      Math.round(used  / MB),
    freeMB:      Math.round(free  / MB),
    usedPercent: Math.round((used / total) * 1000) / 10,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshot — one complete measurement at a point in time
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take a single complete measurement snapshot.
 * @param {string} label  - e.g. "idle", "upload", "tally_export"
 * @param {string} baseUrl - backend base URL
 */
export async function takeSnapshot(label, baseUrl = 'http://localhost:5000') {
  const ts         = new Date();
  const sysRam     = getSystemRamMB();
  const cpuPercent = getSystemCpuPercent();
  const backendMem = await getBackendMemoryMB(baseUrl);

  return {
    label,
    timestamp:   ts.toISOString(),
    epochMs:     ts.getTime(),

    // System RAM
    system: {
      totalMB:     sysRam.totalMB,
      usedMB:      sysRam.usedMB,
      freeMB:      sysRam.freeMB,
      usedPercent: sysRam.usedPercent,
    },

    // Backend process RAM (from /api/health/memory endpoint)
    backend: backendMem
      ? {
          rss:       backendMem.rss,       // Total process RAM (RSS) — the real number
          heapUsed:  backendMem.heapUsed,  // V8 heap in use
          heapTotal: backendMem.heapTotal, // V8 heap allocated
          external:  backendMem.external,  // C++ objects linked to V8 (Buffers)
        }
      : null,

    // CPU
    cpu: {
      systemPercent: cpuPercent,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Continuous monitor — polls at a fixed interval and keeps a rolling array
// ─────────────────────────────────────────────────────────────────────────────

export class RamMonitor {
  /**
   * @param {object} opts
   * @param {number}  opts.intervalMs  - poll interval in ms (default 1000)
   * @param {string}  opts.baseUrl     - backend base URL
   * @param {boolean} opts.verbose     - print each sample to stdout
   */
  constructor({ intervalMs = 1000, baseUrl = 'http://localhost:5000', verbose = false } = {}) {
    this.intervalMs = intervalMs;
    this.baseUrl    = baseUrl;
    this.verbose    = verbose;
    this.samples    = [];      // all snapshots collected
    this._timer     = null;
    this._label     = 'monitoring';
  }

  /** Start continuous polling. */
  start(label = 'monitoring') {
    this._label = label;
    if (this._timer) return; // already running

    const poll = async () => {
      const snap = await takeSnapshot(this._label, this.baseUrl);
      this.samples.push(snap);

      if (this.verbose) {
        const b = snap.backend;
        const s = snap.system;
        const rss = b ? `${b.rss} MB` : 'N/A';
        console.log(
          `  [${snap.label.padEnd(18)}]` +
          `  Backend RSS: ${rss.padStart(8)}` +
          `  Sys RAM: ${s.usedMB}/${s.totalMB} MB (${s.usedPercent}%)` +
          `  CPU: ${snap.cpu.systemPercent}%`
        );
      }
    };

    // Take an immediate first sample, then schedule
    poll();
    this._timer = setInterval(poll, this.intervalMs);
  }

  /** Update the label for the next batch of samples (phase change). */
  setPhase(label) {
    this._label = label;
  }

  /** Stop polling. Returns all collected samples. */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    return this.samples;
  }

  /** Get all samples collected so far without stopping. */
  getSamples() {
    return [...this.samples];
  }

  /**
   * Compute aggregate stats from all samples that match a label substring.
   * Returns { minMB, maxMB, avgMB, peakMB, sampleCount }
   */
  aggregate(labelFilter = null) {
    const filtered = labelFilter
      ? this.samples.filter(s => s.label.includes(labelFilter))
      : this.samples;

    if (filtered.length === 0) return null;

    const rssValues = filtered
      .map(s => s.backend?.rss ?? null)
      .filter(v => v !== null);

    const sysUsed = filtered.map(s => s.system.usedMB);
    const cpuVals = filtered.map(s => s.cpu.systemPercent);

    const safe = (arr, fn) => arr.length > 0 ? fn(arr) : 0;

    return {
      sampleCount:    filtered.length,
      // Backend RSS
      backendRssMin:  safe(rssValues, a => Math.min(...a)),
      backendRssMax:  safe(rssValues, a => Math.max(...a)),
      backendRssAvg:  safe(rssValues, a => Math.round(a.reduce((s,v) => s+v, 0) / a.length * 10) / 10),
      backendRssPeak: safe(rssValues, a => Math.max(...a)),
      // System RAM
      sysUsedMin:     Math.min(...sysUsed),
      sysUsedMax:     Math.max(...sysUsed),
      sysUsedAvg:     Math.round(sysUsed.reduce((s,v) => s+v, 0) / sysUsed.length * 10) / 10,
      // CPU
      cpuMin:         Math.min(...cpuVals),
      cpuMax:         Math.max(...cpuVals),
      cpuAvg:         Math.round(cpuVals.reduce((s,v) => s+v, 0) / cpuVals.length * 10) / 10,
      cpuPeak:        Math.max(...cpuVals),
    };
  }

  /**
   * Return the single peak RSS snapshot across all samples.
   */
  peakSnapshot() {
    if (this.samples.length === 0) return null;
    return this.samples.reduce((best, s) => {
      const rss = s.backend?.rss ?? 0;
      return rss > (best.backend?.rss ?? 0) ? s : best;
    }, this.samples[0]);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Standalone mode — run `node load-test/ram-monitor.js` to watch live
// ─────────────────────────────────────────────────────────────────────────────

if (process.argv[1].endsWith('ram-monitor.js')) {
  const mon = new RamMonitor({ intervalMs: 1000, verbose: true });

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Chakra Backend — Live RAM / CPU Monitor');
  console.log('  Polling every 1 second.  Ctrl+C to stop and print summary.');
  console.log('  Make sure the backend is running on http://localhost:5000');
  console.log('  and the /api/health/memory route is registered.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log(
    '  [phase              ]' +
    '  Backend RSS         ' +
    '  Sys RAM             ' +
    '  CPU'
  );
  console.log('  ' + '─'.repeat(70));

  mon.start('live');

  process.on('SIGINT', () => {
    mon.stop();
    const agg = mon.aggregate();
    if (!agg) {
      console.log('\nNo samples collected.');
      process.exit(0);
    }
    console.log('');
    console.log('━━━  Summary  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`  Samples collected : ${agg.sampleCount}`);
    console.log(`  Backend RSS peak  : ${agg.backendRssPeak} MB`);
    console.log(`  Backend RSS avg   : ${agg.backendRssAvg} MB`);
    console.log(`  Sys RAM peak used : ${agg.sysUsedMax} MB`);
    console.log(`  Sys RAM avg used  : ${agg.sysUsedAvg} MB`);
    console.log(`  CPU peak          : ${agg.cpuPeak}%`);
    console.log(`  CPU avg           : ${agg.cpuAvg}%`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(0);
  });
}
