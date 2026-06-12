/**
 * TallySyncState.js
 *
 * Tracks the state of every Tally pull sync so the system can:
 *  • Resume from the last successful chunk instead of restarting
 *  • Know which date-windows have been fully synced
 *  • Detect if a previous full-sync was incomplete
 *
 * One document per entity type (Vouchers, Ledgers, Items).
 */
import mongoose from 'mongoose';

const chunkSchema = new mongoose.Schema({
  fromDate:    { type: Date, required: true },
  toDate:      { type: Date, required: true },
  status:      { type: String, enum: ['pending', 'success', 'failed', 'partial'], default: 'pending' },
  records:     { type: Number, default: 0 },
  attempts:    { type: Number, default: 0 },
  lastError:   { type: String, default: '' },
  completedAt: { type: Date },
}, { _id: false });

const tallySyncStateSchema = new mongoose.Schema({
  // One doc per entity type
  entityType: {
    type: String,
    required: true,
    unique: true,
    enum: ['Vouchers', 'Ledgers', 'Items', 'Purchase', 'Sales', 'Payment', 'Receipt', 'Journal', 'Contra'],
  },

  // Last date fully synced (incremental sync starts from here)
  lastSyncedDate: { type: Date, default: null },

  // Overall status of the current / last sync run
  syncStatus: {
    type: String,
    enum: ['idle', 'running', 'completed', 'failed', 'partial'],
    default: 'idle',
  },

  // Total records pulled in the last full sync
  totalRecords: { type: Number, default: 0 },

  // Whether last attempt used full-fetch (true) or chunk mode (false)
  usedFullFetch: { type: Boolean, default: false },

  // Chunk-level progress — populated only when in chunk-sync mode
  chunks: [chunkSchema],

  // Index of the last successfully completed chunk (for resume)
  lastCompletedChunkIndex: { type: Number, default: -1 },

  // Start date of the ENTIRE sync window (populated at sync start)
  syncWindowStart: { type: Date, default: null },
  syncWindowEnd:   { type: Date, default: null },

  // Timestamp of last successful complete sync
  lastSuccessAt: { type: Date, default: null },

  // Running sync started at
  syncStartedAt: { type: Date, default: null },
}, { timestamps: true, versionKey: false, optimisticConcurrency: false });

tallySyncStateSchema.index({ entityType: 1 }, { unique: true });

export default mongoose.model('TallySyncState', tallySyncStateSchema);
