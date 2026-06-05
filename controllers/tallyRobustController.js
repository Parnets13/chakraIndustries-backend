/**
 * tallyRobustController.js
 *
 * HTTP handlers for the robust pull engine (tallyFetchEngine.js).
 * All routes are under /api/tally/robust-*
 */

import {
  pullEntityFromTally,
  runRobustFullPull,
  getSyncStateStatus,
  resetSyncState,
} from '../services/tallyFetchEngine.js';

const VALID_ENTITIES = ['Items', 'Ledgers', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra'];

/**
 * POST /api/tally/robust-pull
 * Body: {
 *   entity?      : 'Items'|'Ledgers'|'Purchase'|'Sales'|'Payment'|'Receipt'|'All'
 *   forceChunk?  : boolean  — skip full-fetch, go straight to chunks
 *   forceRefresh?: boolean  — ignore lastSyncedDate, re-pull all history
 *   startDate?   : ISO date string — override chunk window start
 *   endDate?     : ISO date string — override chunk window end
 * }
 */
export const triggerRobustPull = async (req, res) => {
  try {
    const {
      entity       = 'All',
      forceChunk   = false,
      forceRefresh = false,
      startDate,
      endDate,
    } = req.body;

    const opts = {
      forceChunk,
      forceRefresh,
      triggeredBy : req.user?._id,
      startDate   : startDate ? new Date(startDate) : undefined,
      endDate     : endDate   ? new Date(endDate)   : undefined,
    };

    let result;
    if (entity === 'All') {
      result = await runRobustFullPull(opts);
    } else {
      if (!VALID_ENTITIES.includes(entity)) {
        return res.status(400).json({
          success: false,
          message: `Invalid entity. Must be one of: ${VALID_ENTITIES.join(', ')}, All`,
        });
      }
      const r = await pullEntityFromTally(entity, opts);
      result  = { ok: r.ok, records: r.records, results: [{ entity, ...r }], error: r.error };
    }

    res.json({
      success : result.ok,
      message : result.ok
        ? `Robust pull completed — ${result.records} records synced`
        : `Robust pull finished with issues — ${result.records} records synced`,
      data    : result,
    });
  } catch (err) {
    console.error('[RobustController] triggerRobustPull:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/tally/robust-sync-state
 * Returns chunk-level progress for all entity types.
 */
export const getRobustSyncState = async (req, res) => {
  try {
    const states = await getSyncStateStatus();
    res.json({ success: true, data: states });
  } catch (err) {
    console.error('[RobustController] getRobustSyncState:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/tally/robust-sync-state/reset
 * Body: { entity? }
 * If entity is omitted, resets ALL entity states.
 */
export const resetEntitySyncState = async (req, res) => {
  try {
    const { entity } = req.body;
    if (entity) {
      if (!VALID_ENTITIES.includes(entity)) {
        return res.status(400).json({
          success: false,
          message: `Invalid entity. Must be one of: ${VALID_ENTITIES.join(', ')}`,
        });
      }
      await resetSyncState(entity);
      return res.json({ success: true, message: `Sync state reset for ${entity}` });
    }
    // Reset all
    await Promise.all(VALID_ENTITIES.map(e => resetSyncState(e)));
    res.json({ success: true, message: 'Sync state reset for all entities' });
  } catch (err) {
    console.error('[RobustController] resetEntitySyncState:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
