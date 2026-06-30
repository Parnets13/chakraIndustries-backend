import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import ConnectorRegistration from '../models/ConnectorRegistration.js';
import TallyConfig from '../models/TallyConfig.js';

const router = express.Router();

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

export default router;
