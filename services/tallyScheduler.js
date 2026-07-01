
/**
 * tallyScheduler.js
 *
 * Hybrid Tally Sync Scheduler:
 * - Masters (Stock Items, Ledgers, Groups): Import via TDL file export
 * - Transactions (Purchase, Sales, Payment, Receipt, Journal, Contra): Import via Tally API
 */

import TallyConfig from '../models/TallyConfig.js';
import { pullEntityFromTally } from './tallyFetchEngine.js';
import { startFileWatcher } from './tallyFileImporter.js';

const LOG = (msg) => console.log(`[TallyScheduler] ${msg}`);
const ERR = (msg, err) => console.error(`[TallyScheduler Error] ${msg}`, err ? err.message || err : '');

const INTERVAL_MAP = {
  'Every 30 seconds': 30  * 1000,
  'Every 1 minute':   1   * 60 * 1000,
  'Every 5 minutes':  5   * 60 * 1000,
  'Every 15 minutes': 15  * 60 * 1000,
  'Every 30 minutes': 30  * 60 * 1000,
  'Every 1 hour':     60  * 60 * 1000,
  'Manual only':      null,
};

const TRANSACTION_TYPES = ['Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra'];

let _transactionTimer = null;
let _currentTransactionInterval = null;
let _schedulerLock = false;

async function syncTransactions() {
  if (_schedulerLock) {
    LOG('Skipping transaction sync — previous sync still running');
    return;
  }
  _schedulerLock = true;
  try {
    const cfg = await TallyConfig.findOne();
    if (!cfg?.autoSync) return;

    // Support both direct mode (tallyLocalUrl) and connector mode (useConnector + connectorId)
    const hasDirectUrl = cfg.tallyLocalUrl && cfg.tallyLocalUrl.trim() !== '';
    const hasConnector = cfg.useConnector && cfg.connectorId && cfg.connectorId.trim() !== '';

    if (!hasDirectUrl && !hasConnector) {
      LOG('Neither tallyLocalUrl nor connector is configured — skipping transaction sync');
      return;
    }

    // In connector mode, only run if the connector is actually online right now.
    // Avoids queueing up a flood of requests during reconnect windows.
    if (hasConnector && !hasDirectUrl) {
      const { isConnectorOnline } = await import('./tallyConnectorServer.js');
      if (!isConnectorOnline(cfg.connectorId)) {
        LOG(`Connector ${cfg.connectorId} is offline — skipping scheduled sync (will retry next interval)`);
        return;
      }
    }

    LOG('Starting transaction sync...');
    for (const type of TRANSACTION_TYPES) {
      try {
        LOG(`Syncing ${type}...`);
        await pullEntityFromTally(type);
      } catch (err) {
        ERR(`Failed to sync ${type}`, err);
      }
    }
    LOG('Transaction sync complete');
  } catch (err) {
    if (err.message?.includes('ENOTFOUND') || err.message?.includes('getaddrinfo')) {
      LOG('Tally server unreachable - will retry on next interval');
    } else {
      ERR('Transaction sync error', err);
    }
  } finally {
    _schedulerLock = false;
  }
}

export function startTallyScheduler() {
  // Start file watcher for master data (Stock Items, Ledgers)
  (async () => {
    try {
      await startFileWatcher();
      LOG('Started file watcher for master data exports');
    } catch (err) {
      ERR('Failed to start file watcher', err);
    }
  })();

  // Check config every 60 seconds and adjust timer if interval changed
  setInterval(async () => {
    try {
      const cfg = await TallyConfig.findOne();
      if (!cfg?.autoSync) {
        if (_transactionTimer) { clearInterval(_transactionTimer); _transactionTimer = null; _currentTransactionInterval = null; }
        return;
      }
      const ms = INTERVAL_MAP[cfg.syncInterval] ?? INTERVAL_MAP['Every 15 minutes'];
      if (ms === null) {
        if (_transactionTimer) { clearInterval(_transactionTimer); _transactionTimer = null; _currentTransactionInterval = null; }
        return;
      }
      if (_currentTransactionInterval !== ms) {
        if (_transactionTimer) clearInterval(_transactionTimer);
        _transactionTimer = setInterval(syncTransactions, ms);
        _currentTransactionInterval = ms;
        LOG(`Transaction sync interval set to ${cfg.syncInterval}`);
      }
    } catch (_) { /* DB not ready yet */ }
  }, 60_000);

  // Run initial sync after a short delay
  setTimeout(async () => {
    try {
      const cfg = await TallyConfig.findOne();
      if (cfg?.autoSync && cfg.syncInterval !== 'Manual only') {
        const ms = INTERVAL_MAP[cfg.syncInterval] ?? INTERVAL_MAP['Every 15 minutes'];
        if (ms) {
          _transactionTimer = setInterval(syncTransactions, ms);
          _currentTransactionInterval = ms;
          LOG(`Started — auto-syncing transactions from Tally ${cfg.syncInterval}`);
          LOG('Master data sync via TDL file exports (C:\\TallyExports)');
        }
      }
    } catch (_) { /* ignore */ }
  }, 10_000);
}
