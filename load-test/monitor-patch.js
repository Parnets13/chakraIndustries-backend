/**
 * monitor-patch.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Registers a single read-only GET /api/health/memory route on the running
 * Express app so the RAM monitor can poll it.
 *
 * HOW IT WORKS
 * ────────────
 * The Chakra backend exposes its Express `app` instance via a named export
 * in server.js.  This patch file imports it at runtime (after the server is
 * already listening) and inserts ONE extra route with no side effects.
 *
 * IMPORTANT:
 *   This file is loaded by load-test-runner.js BEFORE starting the test.
 *   It does NOT modify server.js or any other source file.
 *   It adds no database operations, no authentication, and no logging.
 *   The route is never called in production (it only exists in the test process).
 *
 * The /api/health/memory endpoint returns:
 *   { rss, heapUsed, heapTotal, external, arrayBuffers }
 * All values are in BYTES (raw from process.memoryUsage()).
 *
 * SAFE: Read-only. No writes. No auth needed because this is a load test
 *       running on localhost only.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Register the memory-probe route on an Express app instance.
 * Call this once before the test begins.
 *
 * @param {import('express').Express} app  - The Express app object from server.js
 */
export function registerMemoryRoute(app) {
  // Guard: don't register twice if called multiple times
  if (app._chakraMemoryRouteRegistered) return;
  app._chakraMemoryRouteRegistered = true;

  app.get('/api/health/memory', (_req, res) => {
    const mem = process.memoryUsage();
    res.json({
      rss:          mem.rss,           // Total RAM consumed by the process (RSS)
      heapUsed:     mem.heapUsed,      // V8 heap actually used
      heapTotal:    mem.heapTotal,     // V8 heap allocated/reserved
      external:     mem.external,      // C++ objects bound to V8 (Buffers)
      arrayBuffers: mem.arrayBuffers,  // ArrayBuffers / SharedArrayBuffers
    });
  });

  console.log('[monitor-patch] ✓ /api/health/memory route registered');
}
