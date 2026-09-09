/**
 * tallyExportLock.js
 *
 * Tiny shared in-memory flag that marks when a MANUAL Tally export
 * (user-triggered from the Tally page) is in progress.
 *
 * Purpose: the background scheduler and a manual export must never run Tally
 * requests at the same time, because they share a single connector → single
 * Tally instance. Concurrent requests block each other and cause a batch to
 * time out (the reason some invoices were silently skipped mid-export).
 *
 * This changes NO existing behaviour on its own — it only exposes a flag that
 * the scheduler checks so it politely waits its turn while a manual export is
 * running. Manual exports are never blocked.
 */

let _manualExportActive = false;

export function beginManualExport() {
  _manualExportActive = true;
}

export function endManualExport() {
  _manualExportActive = false;
}

export function isManualExportActive() {
  return _manualExportActive;
}
