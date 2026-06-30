import express from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import ConnectorRegistration from '../models/ConnectorRegistration.js';

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

    if (!machineId) {
      return res.status(400).json({ success: false, message: 'machineId is required' });
    }

    // Find existing or create new registration
    let registration = await ConnectorRegistration.findOne({ machineId });

    if (!registration) {
      // New connector — generate a unique connectorId
      const connectorId = `conn_${crypto.randomBytes(8).toString('hex')}`;
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
    } else {
      // Existing connector — update system info and refresh lastSeen
      registration.computerName    = computerName    || registration.computerName;
      registration.windowsUsername = windowsUsername || registration.windowsUsername;
      registration.operatingSystem = operatingSystem || registration.operatingSystem;
      registration.connectorVersion = connectorVersion || registration.connectorVersion;
      registration.tallyVersion    = tallyVersion    || registration.tallyVersion;
      registration.lastSeenAt      = new Date();
      await registration.save();
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
