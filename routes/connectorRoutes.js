import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import ConnectorRegistration from '../models/ConnectorRegistration.js';
import TallyConfig from '../models/TallyConfig.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// ── In-memory HTTP-poll job queue ────────────────────────────────────────────
// Structure: Map<jobId, { xml, resolve, reject, timeout, connectorId, createdAt }>
const httpJobQueue   = new Map();   // pending (not yet picked up)
const httpJobResults = new Map();   // finished (waiting for server to consume)

export function enqueueConnectorJob(connectorId, xml, timeoutMs) {
  return new Promise((resolve, reject) => {
    const jobId = crypto.randomUUID();
    const timeout = setTimeout(() => {
      if (httpJobQueue.has(jobId)) {
        httpJobQueue.delete(jobId);
        reject(new Error(`Connector HTTP job timed out after ${timeoutMs}ms — Tally may be slow or the connector is offline`));
      } else if (httpJobResults.has(jobId)) {
        httpJobResults.delete(jobId);
        reject(new Error(`Connector HTTP job timed out after ${timeoutMs}ms — connector picked up the job but did not return a result`));
      }
    }, timeoutMs);
    httpJobQueue.set(jobId, { xml, resolve, reject, timeout, connectorId, createdAt: Date.now() });
    console.log(`[ConnectorHTTP] Enqueued job ${jobId} for connector ${connectorId} (queue size: ${httpJobQueue.size})`);
  });
}

// ── Middleware: verify connector JWT ─────────────────────────────────────────
export const protectConnector = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'No token provided' });
    }
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.type !== 'connector') {
      return res.status(401).json({ success: false, message: 'Invalid token type' });
    }
    const registration = await ConnectorRegistration.findOne({ machineId: decoded.machineId });
    if (!registration || !registration.isActive) {
      return res.status(401).json({ success: false, message: 'Connector not found or inactive' });
    }
    req.connector = registration;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, message: 'Token invalid or expired' });
  }
};

/**
 * POST /api/connector/register
 * Each device gets its own permanent connectorId + connectorSecret stored in
 * ConnectorRegistration. TallyConfig is no longer overwritten on every registration —
 * only the "default" connector's id is written there (set via /set-default).
 * If this is the very first connector ever, it becomes the default automatically.
 */
router.post('/register', async (req, res) => {
  try {
    const { machineId, computerName, windowsUsername, operatingSystem, connectorVersion, tallyVersion } = req.body;
    if (!machineId) return res.status(400).json({ success: false, message: 'machineId is required' });

    console.log('[ConnectorRegister] Registration request', { machineId, computerName });

    let registration = await ConnectorRegistration.findOne({ machineId });
    let connectorSecret;

    if (!registration) {
      // Brand-new device — give it its own credentials
      const connectorId = `conn_${crypto.randomBytes(8).toString('hex')}`;
      connectorSecret   = crypto.randomBytes(32).toString('hex');

      // Is this the very first connector? If so, make it default.
      const existingCount = await ConnectorRegistration.countDocuments({});
      const isFirst = existingCount === 0;

      registration = await ConnectorRegistration.create({
        machineId,
        computerName:     computerName    || '',
        windowsUsername:  windowsUsername || '',
        operatingSystem:  operatingSystem || '',
        connectorVersion: connectorVersion || '1.0.0',
        tallyVersion:     tallyVersion    || '',
        connectorId,
        connectorSecret,
        isDefault: isFirst,
        syncInterval: 300,
      });

      console.log('[ConnectorRegister] New connector created', { connectorId, isDefault: isFirst });

      // Only update TallyConfig when this is the first/default connector
      if (isFirst) {
        await TallyConfig.findOneAndUpdate(
          {},
          { connectorId, connectorSecret, useConnector: true, connectionStatus: 'Disconnected' },
          { sort: { _id: 1 }, upsert: true, new: true }
        );
        console.log('[ConnectorRegister] TallyConfig updated with first connector credentials');
      }

    } else {
      // Existing device re-registering — refresh metadata + credentials
      connectorSecret = registration.connectorSecret || crypto.randomBytes(32).toString('hex');

      registration.computerName     = computerName    || registration.computerName;
      registration.windowsUsername  = windowsUsername || registration.windowsUsername;
      registration.operatingSystem  = operatingSystem || registration.operatingSystem;
      registration.connectorVersion = connectorVersion || registration.connectorVersion;
      registration.tallyVersion     = tallyVersion    || registration.tallyVersion;
      registration.connectorSecret  = connectorSecret;
      registration.lastSeenAt       = new Date();
      await registration.save();

      console.log('[ConnectorRegister] Existing connector refreshed', { connectorId: registration.connectorId, isDefault: registration.isDefault });

      // If this device is the default, keep TallyConfig in sync
      if (registration.isDefault) {
        await TallyConfig.findOneAndUpdate(
          {},
          { connectorId: registration.connectorId, connectorSecret, useConnector: true },
          { sort: { _id: 1 }, upsert: true, new: true }
        );
      }
    }

    const token = jwt.sign(
      { machineId: registration.machineId, connectorId: registration.connectorId, type: 'connector' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      success: true,
      token,
      connectorId:     registration.connectorId,
      connectorSecret: connectorSecret,
      syncInterval:    registration.syncInterval,
      tunnelToken:     process.env.CLOUDFLARE_TUNNEL_TOKEN || null,
      message:         'Connector registered successfully',
    });
  } catch (error) {
    console.error('[Connector Register Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/connector/heartbeat
 */
router.post('/heartbeat', protectConnector, async (req, res) => {
  try {
    req.connector.lastSeenAt = new Date();
    await req.connector.save();
    return res.json({ success: true, syncInterval: req.connector.syncInterval });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * GET /api/connector/verify
 */
router.get('/verify', protectConnector, async (req, res) => {
  return res.json({
    success:     true,
    connectorId: req.connector.connectorId,
    syncInterval: req.connector.syncInterval,
    tunnelToken: process.env.CLOUDFLARE_TUNNEL_TOKEN || null,
  });
});

/**
 * GET /api/connector/list  (ERP admin only)
 * Returns all registered connectors with their online status.
 */
router.get('/list', protect, async (req, res) => {
  try {
    const { isConnectorOnline } = await import('../services/tallyConnectorServer.js');
    const registrations = await ConnectorRegistration.find({}).sort({ createdAt: 1 }).lean();
    const result = registrations.map(r => ({
      _id:              r._id,
      connectorId:      r.connectorId,
      computerName:     r.computerName,
      windowsUsername:  r.windowsUsername,
      operatingSystem:  r.operatingSystem,
      connectorVersion: r.connectorVersion,
      tallyVersion:     r.tallyVersion,
      isDefault:        r.isDefault,
      isActive:         r.isActive,
      lastSeenAt:       r.lastSeenAt,
      online:           isConnectorOnline(r.connectorId),
    }));
    res.json({ success: true, data: result });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * POST /api/connector/set-default/:connectorId  (ERP admin only)
 * Makes the specified connector the active one for all Tally data requests.
 */
router.post('/set-default/:connectorId', protect, async (req, res) => {
  try {
    const { connectorId } = req.params;
    const target = await ConnectorRegistration.findOne({ connectorId });
    if (!target) return res.status(404).json({ success: false, message: 'Connector not found' });

    // Clear isDefault on all, then set on target
    await ConnectorRegistration.updateMany({}, { $set: { isDefault: false } });
    target.isDefault = true;
    await target.save();

    // Update TallyConfig to point to the new default
    await TallyConfig.findOneAndUpdate(
      {},
      {
        connectorId:     target.connectorId,
        connectorSecret: target.connectorSecret,
        useConnector:    true,
        connectionStatus: 'Disconnected', // will update once connector connects
      },
      { sort: { _id: 1 }, upsert: true, new: true }
    );

    console.log('[ConnectorSetDefault] Active connector changed to', connectorId);
    res.json({ success: true, message: `Active connector set to ${target.computerName || connectorId}` });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * DELETE /api/connector/remove/:connectorId  (ERP admin only)
 * Removes a connector registration.
 */
router.delete('/remove/:connectorId', protect, async (req, res) => {
  try {
    const { connectorId } = req.params;
    const target = await ConnectorRegistration.findOneAndDelete({ connectorId });
    if (!target) return res.status(404).json({ success: false, message: 'Connector not found' });

    // If we deleted the default, auto-promote the oldest remaining connector
    if (target.isDefault) {
      const next = await ConnectorRegistration.findOne({}).sort({ createdAt: 1 });
      if (next) {
        next.isDefault = true;
        await next.save();
        await TallyConfig.findOneAndUpdate(
          {},
          { connectorId: next.connectorId, connectorSecret: next.connectorSecret, useConnector: true },
          { sort: { _id: 1 } }
        );
        console.log('[ConnectorRemove] Auto-promoted next connector as default', next.connectorId);
      } else {
        // No connectors left — clear connector mode
        await TallyConfig.findOneAndUpdate(
          {},
          { connectorId: '', connectorSecret: '', useConnector: false, connectionStatus: 'Disconnected' },
          { sort: { _id: 1 } }
        );
      }
    }
    res.json({ success: true, message: 'Connector removed' });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

/**
 * GET /api/connector/poll-job
 * Connector long-polls for pending Tally jobs.
 */
router.get('/poll-job', protectConnector, async (req, res) => {
  const connectorId    = req.connector.connectorId;
  const LONG_POLL_MS   = 20000;
  const CHECK_INTERVAL = 300;
  let waited = 0;
  let done   = false;

  const check = () => {
    if (done) return;
    for (const [jobId, job] of httpJobQueue.entries()) {
      if (job.connectorId === connectorId) {
        httpJobQueue.delete(jobId);
        httpJobResults.set(jobId, { resolve: job.resolve, reject: job.reject, timeout: job.timeout });
        console.log(`[ConnectorHTTP] Job ${jobId} dispatched to connector ${connectorId}`);
        done = true;
        return res.json({ job: { id: jobId, xml: job.xml } });
      }
    }
    waited += CHECK_INTERVAL;
    if (waited >= LONG_POLL_MS) { done = true; return res.json({ job: null }); }
    setTimeout(check, CHECK_INTERVAL);
  };

  res.on('close', () => { done = true; });
  check();
});

/**
 * POST /api/connector/job-result
 */
router.post('/job-result', protectConnector, async (req, res) => {
  const { jobId, success, data, error } = req.body;
  if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });

  if (httpJobQueue.has(jobId)) httpJobQueue.delete(jobId);

  const job = httpJobResults.get(jobId);
  if (job) {
    httpJobResults.delete(jobId);
    clearTimeout(job.timeout);
    if (success) {
      console.log(`[ConnectorHTTP] Job ${jobId} succeeded — ${(data || '').length} bytes`);
      job.resolve(data || '');
    } else {
      console.error(`[ConnectorHTTP] Job ${jobId} failed — ${error}`);
      job.reject(new Error(error || 'Connector reported failure'));
    }
  } else {
    console.warn(`[ConnectorHTTP] Job ${jobId} result received but already resolved/timed out — discarding`);
  }
  return res.json({ success: true });
});

export { httpJobQueue, httpJobResults };
export default router;
