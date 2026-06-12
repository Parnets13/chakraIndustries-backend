/**
 * tallyScheduler.js
 *
 * Automatic scheduled import: Tally → ERP only.
 * The scheduler NEVER pushes ERP data to Tally — that must be triggered
 * explicitly by the user via the "Export to Tally" action in the UI.
 *
 * Uses the robust pull engine (tallyFetchEngine.js) which supports
 * full-fetch + chunk-sync fallback, state tracking, and resume on failure.
 */

import TallyConfig from '../models/TallyConfig.js';
import { runRobustFullPull } from './tallyFetchEngine.js';

const INTERVAL_MAP = {
  'Every 30 seconds': 30  * 1000,
  'Every 1 minute':   1   * 60 * 1000,
  'Every 5 minutes':  5   * 60 * 1000,
  'Every 15 minutes': 15  * 60 * 1000,
  'Every 30 minutes': 30  * 60 * 1000,
  'Every 1 hour':     60  * 60 * 1000,
  'Manual only':      null,
};

let _timer = null;
let _currentInterval = null;

// In-process lock — prevents overlapping scheduled runs
let _schedulerLock = false;

async function tick() {
  if (_schedulerLock) {
    console.log('[TallyScheduler] Skipping tick — previous import still running');
    return;
  }
  _schedulerLock = true;
  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg?.autoSync) return;

    // Check if Tally URL is configured and valid
    if (!cfg.tallyLocalUrl || cfg.tallyLocalUrl.trim() === '') {
      console.log('[TallyScheduler] tallyLocalUrl not configured — skipping scheduled import');
      return;
    }

    console.log('[TallyScheduler] Running scheduled import (Tally → ERP)...');

    // Always import only — never auto-export
    const result = await runRobustFullPull({ triggeredBy: null });

    console.log(`[TallyScheduler] Scheduled import done — ${result.records} records, ok=${result.ok}`);
  } catch (err) {
    // Suppress DNS/network errors to avoid log spam
    if (err.message?.includes('ENOTFOUND') || err.message?.includes('getaddrinfo')) {
      console.log('[TallyScheduler] Tally server unreachable - will retry on next interval');
    } else {
      console.error('[TallyScheduler] Scheduled import error:', err.message);
    }
  } finally {
    _schedulerLock = false;
  }
}

/** Start (or restart) the scheduler. Called once from server.js after DB connects. */
export function startTallyScheduler() {
  // Check config every 60 seconds and adjust timer if interval changed
  setInterval(async () => {
    try {
      const cfg = await TallyConfig.findOne();
      if (!cfg?.autoSync) {
        if (_timer) { clearInterval(_timer); _timer = null; _currentInterval = null; }
        return;
      }
      const ms = INTERVAL_MAP[cfg.syncInterval] ?? INTERVAL_MAP['Every 15 minutes'];
      if (ms === null) {
        if (_timer) { clearInterval(_timer); _timer = null; _currentInterval = null; }
        return;
      }
      if (_currentInterval !== ms) {
        if (_timer) clearInterval(_timer);
        _timer = setInterval(tick, ms);
        _currentInterval = ms;
        console.log(`[TallyScheduler] Import interval set to ${cfg.syncInterval}`);
      }
    } catch (_) { /* DB not ready yet */ }
  }, 60_000);

  // Run once on startup after a short delay
  setTimeout(async () => {
    try {
      const cfg = await TallyConfig.findOne();
      if (cfg?.autoSync && cfg.syncInterval !== 'Manual only') {
        const ms = INTERVAL_MAP[cfg.syncInterval] ?? INTERVAL_MAP['Every 15 minutes'];
        if (ms) {
          _timer = setInterval(tick, ms);
          _currentInterval = ms;
          console.log(`[TallyScheduler] Started — auto-importing from Tally ${cfg.syncInterval}`);
        }
      }
    } catch (_) { /* ignore */ }
  }, 10_000);
}
