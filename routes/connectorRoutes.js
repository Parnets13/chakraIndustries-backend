import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import ConnectorRegistration from '../models/ConnectorRegistration.js';
import TallyConfig from '../models/TallyConfig.js';

const router = express.Router();

// ── In-memory HTTP-poll job queue ────────────────────────────────────────────
// Jobs are placed here by sendTallyRequestHttp() and picked up by the connector
// via GET /api/connector/poll-job. Results come back via POST /api/connector/job-result.
//
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

    // Store the full job (including resolve/reject) in queue
    httpJobQueue.set(jobId, { xml, resolve, reject, timeout, connectorId, createdAt: Date.now() });
    console.log(`[ConnectorHTTP] Enqueued job ${jobId} for connector ${connectorId} (queue size: ${httpJobQueue.size})`);
  });
}

// Middleware to verify connector JWT
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
 * Auto-registers a connector using system info (no user credentials required).
 * Idempotent — re-registering with the same machineId refreshes the token.
 */
router.post('/register', async (req, res) => {
  try {
    const {
      machineId,
      computerName,
      windowsUsername,
      operatingSystem,
      connectorVersion,
      tallyVersion,
    } = req.body;

    console.log('[ConnectorRegister] Received registration request', { machineId, computerName });

    if (!machineId) {
      return res.status(400).json({ success: false, message: 'machineId is required' });
    }

    // Find existing or create new registration
    let registration = await ConnectorRegistration.findOne({ machineId });
    let connectorSecret;

    if (!registration) {
      // New connector — generate a unique connectorId and connectorSecret
      const connectorId = `conn_${crypto.randomBytes(8).toString('hex')}`;
      connectorSecret = crypto.randomBytes(32).toString('hex');

      console.log('[ConnectorRegister] New connector — creating registration', { connectorId });

      registration = await ConnectorRegistration.create({
        machineId,
        computerName:    computerName    || '',
        windowsUsername: windowsUsername || '',
        operatingSystem: operatingSystem || '',
        connectorVersion: connectorVersion || '1.0.0',
        tallyVersion:    tallyVersion    || '',
        connectorId,
        syncInterval: 300,
      });

      // Always update the SAME TallyConfig document that getCfg() will read.
      // findOne() and findOneAndUpdate({}) both use natural order (oldest _id first),
      // so sort: { _id: 1 } ensures we hit the same document every time.
      const beforeUpdate = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      console.log('[ConnectorRegister] TallyConfig BEFORE update', {
        _id: beforeUpdate?._id,
        useConnector: beforeUpdate?.useConnector,
        connectorId: beforeUpdate?.connectorId || '(empty)',
        connectionStatus: beforeUpdate?.connectionStatus,
      });

      const updated = await TallyConfig.findOneAndUpdate(
        {},
        { 
          connectorId, 
          connectorSecret, 
          useConnector: true,
          connectionStatus: 'Disconnected' 
        },
        { sort: { _id: 1 }, upsert: true, new: true }
      );

      console.log('[ConnectorRegister] TallyConfig AFTER update', {
        _id: updated?._id,
        useConnector: updated?.useConnector,
        connectorId: updated?.connectorId,
        connectionStatus: updated?.connectionStatus,
      });

    } else {
      // Existing connector — update system info and refresh lastSeen
      console.log('[ConnectorRegister] Existing connector found', { connectorId: registration.connectorId });

      registration.computerName    = computerName    || registration.computerName;
      registration.windowsUsername = windowsUsername || registration.windowsUsername;
      registration.operatingSystem = operatingSystem || registration.operatingSystem;
      registration.connectorVersion = connectorVersion || registration.connectorVersion;
      registration.tallyVersion    = tallyVersion    || registration.tallyVersion;
      registration.lastSeenAt      = new Date();
      await registration.save();

      // Look up the canonical TallyConfig (the one getCfg() uses — oldest by _id).
      // Do NOT search by connectorId since the canonical doc may not have it yet.
      const cfg = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
      connectorSecret = cfg?.connectorSecret || crypto.randomBytes(32).toString('hex');

      console.log('[ConnectorRegister] TallyConfig BEFORE update (existing connector)', {
        _id: cfg?._id,
        useConnector: cfg?.useConnector,
        connectorId: cfg?.connectorId || '(empty)',
        hasConnectorSecret: !!(cfg?.connectorSecret),
        connectionStatus: cfg?.connectionStatus,
      });

      // Always write connector fields to the canonical (oldest) document so
      // getCfg() picks them up correctly on the next request.
      const updated = await TallyConfig.findOneAndUpdate(
        {},
        {
          connectorId: registration.connectorId,
          connectorSecret,
          useConnector: true,
          connectionStatus: cfg?.connectionStatus === 'Connected' ? 'Connected' : 'Disconnected',
        },
        { sort: { _id: 1 }, upsert: true, new: true }
      );

      console.log('[ConnectorRegister] TallyConfig AFTER update (existing connector)', {
        _id: updated?._id,
        useConnector: updated?.useConnector,
        connectorId: updated?.connectorId,
        connectionStatus: updated?.connectionStatus,
      });
    }

    // Issue a long-lived JWT (30 days)
    const token = jwt.sign(
      { machineId: registration.machineId, connectorId: registration.connectorId, type: 'connector' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    return res.json({
      success: true,
      token,
      connectorId:  registration.connectorId,
      connectorSecret: connectorSecret,
      syncInterval: registration.syncInterval,
      tunnelToken:  process.env.CLOUDFLARE_TUNNEL_TOKEN || null,
      message: 'Connector registered successfully',
    });
  } catch (error) {
    console.error('[Connector Register Error]', error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

/**
 * POST /api/connector/heartbeat
 * Called periodically by the connector to confirm it is still online.
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
 * Verifies that the stored token is still valid.
 */
router.get('/verify', protectConnector, async (req, res) => {
  return res.json({
    success: true,
    connectorId:  req.connector.connectorId,
    syncInterval: req.connector.syncInterval,
    tunnelToken:  process.env.CLOUDFLARE_TUNNEL_TOKEN || null,
  });
});

/**
 * GET /api/connector/poll-job
 * Connector calls this every 2s to check for pending Tally jobs.
 * Returns the next job for this connector, or { job: null } if the queue is empty.
 * Uses long-polling: holds the request open for up to 20s waiting for a job.
 */
router.get('/poll-job', protectConnector, async (req, res) => {
  const connectorId = req.connector.connectorId;
  const LONG_POLL_MS = 20000;  // hold connection up to 20s
  const CHECK_INTERVAL = 300;  // check queue every 300ms

  let waited = 0;
  let done = false;

  const check = () => {
    if (done) return;

    // Find the oldest pending job for this connector
    for (const [jobId, job] of httpJobQueue.entries()) {
      if (job.connectorId === connectorId) {
        // Move to httpJobResults so job-result handler can resolve the promise
        httpJobQueue.delete(jobId);
        httpJobResults.set(jobId, { resolve: job.resolve, reject: job.reject, timeout: job.timeout });
        console.log(`[ConnectorHTTP] Job ${jobId} dispatched to connector ${connectorId}`);
        done = true;
        return res.json({ job: { id: jobId, xml: job.xml } });
      }
    }

    waited += CHECK_INTERVAL;
    if (waited >= LONG_POLL_MS) {
      done = true;
      return res.json({ job: null });
    }
    setTimeout(check, CHECK_INTERVAL);
  };

  // Cleanup if client disconnects before we respond
  res.on('close', () => { done = true; });
  check();
});

/**
 * POST /api/connector/job-result
 * Connector posts the Tally XML response for a completed job.
 * Body: { jobId, success, data, error }
 */
router.post('/job-result', protectConnector, async (req, res) => {
  const { jobId, success, data, error } = req.body;

  if (!jobId) return res.status(400).json({ success: false, message: 'jobId required' });

  // The job might still be in the queue (shouldn't happen, but guard it)
  if (httpJobQueue.has(jobId)) {
    httpJobQueue.delete(jobId);
  }

  // Resolve / reject the promise that sendTallyRequestHttp() is awaiting
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
    // Already timed out — log but don't error, connector did its job
    console.warn(`[ConnectorHTTP] Job ${jobId} result received but promise already resolved/timed out — discarding`);
  }

  return res.json({ success: true });
});

// Re-export maps so tallyConnectorServer can import them if needed
export { httpJobQueue, httpJobResults };

export default router;
