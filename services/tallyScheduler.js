/**
 * tallyScheduler.js
 * Polls the TallyConfig document and runs auto-sync at the configured interval.
 * Uses a simple setInterval loop — no external cron library needed.
 */

import TallyConfig from '../models/TallyConfig.js';
import { runFullSync } from './tallyService.js';

const INTERVAL_MAP = {
  'Every 5 minutes':  5  * 60 * 1000,
  'Every 15 minutes': 15 * 60 * 1000,
  'Every 30 minutes': 30 * 60 * 1000,
  'Every 1 hour':     60 * 60 * 1000,
  'Manual only':      null,
};

let _timer = null;
let _currentInterval = null;

async function tick() {
  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg?.autoSync) return;
    console.log('[TallyScheduler] Running auto-sync...');
    const result = await runFullSync(null);
    console.log(`[TallyScheduler] Auto-sync done — ${result.records} records, ok=${result.ok}`);
  } catch (err) {
    console.error('[TallyScheduler] Auto-sync error:', err.message);
  }
}

/** Start (or restart) the scheduler. Called once from server.js after DB connects. */
export function startTallyScheduler() {
  // Check config every 60 seconds and adjust the timer if the interval changed
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
        console.log(`[TallyScheduler] Scheduled auto-sync every ${cfg.syncInterval}`);
      }
    } catch (_) { /* DB not ready yet */ }
  }, 60_000);

  // Also run once on startup after a short delay
  setTimeout(async () => {
    try {
      const cfg = await TallyConfig.findOne();
      if (cfg?.autoSync && cfg.syncInterval !== 'Manual only') {
        const ms = INTERVAL_MAP[cfg.syncInterval] ?? INTERVAL_MAP['Every 15 minutes'];
        if (ms) {
          _timer = setInterval(tick, ms);
          _currentInterval = ms;
          console.log(`[TallyScheduler] Started — syncing ${cfg.syncInterval}`);
        }
      }
    } catch (_) { /* ignore */ }
  }, 10_000);
}
