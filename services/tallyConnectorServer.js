import { Server } from 'socket.io';
import TallyConfig from '../models/TallyConfig.js';
import ConnectorRegistration from '../models/ConnectorRegistration.js';
// HTTP-poll job queue — actual Tally data requests go through this, not Socket.IO.
// Socket.IO is kept only for connector online/offline status tracking.
import { enqueueConnectorJob } from '../routes/connectorRoutes.js';

// In-memory store for connected connectors (status tracking only — data goes via HTTP poll)
const connectedConnectors = new Map(); // key: connectorId, value: { socket, lastSeen, online }

let io = null;

// Initialize Socket.IO server
export function initConnectorServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
    // Force polling transport — Render's load balancer drops WebSocket connections
    // mid-payload when large XML data flows through. HTTP long-polling is reliable
    // on Render because each message is a standard HTTP POST (no persistent TCP upgrade).
    transports: ['polling'],
    // Allow long-running Tally requests (large datasets can take minutes)
    pingTimeout:  600000,  // 10 minutes — how long to wait for a pong before disconnecting
    pingInterval:  25000,  // 25 seconds — how often to send a ping
  });

  // Middleware for authentication
  io.use(async (socket, next) => {
    try {
      const { connectorId, connectorSecret } = socket.handshake.auth;
      
      if (!connectorId || !connectorSecret) {
        return next(new Error('Authentication required'));
      }

      // Verify against ConnectorRegistration — secrets are stored per-device there,
      // not in TallyConfig (which only holds the default connector's id reference).
      const registration = await ConnectorRegistration.findOne({ connectorId });
      if (!registration || registration.connectorSecret !== connectorSecret) {
        console.warn(`[Connector] Socket.IO auth failed for ${connectorId} — registration found: ${!!registration}`);
        return next(new Error('Invalid credentials'));
      }
      if (!registration.isActive) {
        console.warn(`[Connector] Socket.IO auth rejected — connector ${connectorId} is inactive`);
        return next(new Error('Connector is inactive'));
      }

      socket.connectorId = connectorId;
      next();
    } catch (error) {
      next(new Error('Authentication failed'));
    }
  });

  // Handle connections
  io.on('connection', async (socket) => {
    console.log(`[Connector] Socket.IO connected: ${socket.connectorId}`);

    // Track connector (update socket reference to the new one)
    connectedConnectors.set(socket.connectorId, {
      socket,
      lastSeen: new Date(),
      online: true
    });

    // Update TallyConfig connection status — use sort to hit the canonical document
    const beforeConn = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    console.log('[Connector] TallyConfig BEFORE connectionStatus update (connect)', {
      _id: beforeConn?._id,
      connectorId: beforeConn?.connectorId,
      useConnector: beforeConn?.useConnector,
      connectionStatus: beforeConn?.connectionStatus,
    });

    const afterConn = await TallyConfig.findOneAndUpdate(
      { connectorId: socket.connectorId },
      { connectionStatus: 'Connected' },
      { new: true }
    );

    if (!afterConn) {
      // Fallback: the canonical doc may not have connectorId yet — patch it directly
      console.warn(`[Connector] findOneAndUpdate by connectorId matched nothing — falling back to sort-based update`);
      await TallyConfig.findOneAndUpdate(
        {},
        { connectionStatus: 'Connected', connectorId: socket.connectorId },
        { sort: { _id: 1 } }
      );
    }

    const verify = await TallyConfig.findOne({}, null, { sort: { _id: 1 } });
    console.log('[Connector] TallyConfig AFTER connectionStatus update (connect)', {
      _id: verify?._id,
      connectorId: verify?.connectorId,
      useConnector: verify?.useConnector,
      connectionStatus: verify?.connectionStatus,
    });

    // Handle tally-response from connector (legacy Socket.IO path — kept for backward compat
    // with older connector builds, but new connectors use HTTP poll/result instead)
    socket.on('tally-response', (response) => {
      console.warn(`[Connector] Received legacy tally-response via Socket.IO for ${response?.id} — ignored (use HTTP poll)`);
    });

    socket.on('disconnect', async (reason) => {
      console.log(`[Connector] Socket.IO disconnected: ${socket.connectorId} — reason: ${reason}`);
      
      // Update connector status — data requests are unaffected (they use HTTP polling)
      if (connectedConnectors.has(socket.connectorId)) {
        connectedConnectors.get(socket.connectorId).online = false;
      }

      const afterDisconn = await TallyConfig.findOneAndUpdate(
        { connectorId: socket.connectorId },
        { connectionStatus: 'Disconnected' },
        { new: true }
      );

      if (!afterDisconn) {
        console.warn(`[Connector] Disconnect update by connectorId matched nothing — falling back to sort-based update`);
        await TallyConfig.findOneAndUpdate(
          {},
          { connectionStatus: 'Disconnected' },
          { sort: { _id: 1 } }
        );
      }

      console.log('[Connector] TallyConfig after disconnect update', {
        _id: afterDisconn?._id,
        connectorId: afterDisconn?.connectorId,
        connectionStatus: afterDisconn?.connectionStatus,
      });
    });
  });

  return io;
}

// Wait up to waitMs for the connector to come back online (handles Render restart race)
export async function waitForConnector(connectorId, waitMs = 30000) {
  const interval = 500;
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const c = connectedConnectors.get(connectorId);
    if (c && c.online) return c;
    await new Promise(r => setTimeout(r, interval));
  }
  return null;
}

// Send XML request to specific connector via HTTP polling (no Socket.IO dependency)
// The connector polls GET /api/connector/poll-job and POSTs the result back.
// This is completely immune to Socket.IO disconnects on large payloads.
export async function sendTallyRequest(connectorId, xml, timeoutMs = 60000) {
  // ── Liveness check ────────────────────────────────────────────────────────
  // Primary check: Socket.IO in-memory map (instantaneous).
  // Fallback check: DB lastSeenAt — connector is alive if it polled within
  // the last 90s (3 × 30s poll interval).  Socket.IO ping/pong gaps (~25s) can
  // cause isConnectorOnline() to flip false even when the connector is running
  // and actively picking up HTTP jobs.  The DB timestamp bridges that gap.
  let connectorAlive = isConnectorOnline(connectorId);

  if (!connectorAlive) {
    try {
      const reg = await ConnectorRegistration.findOne({ connectorId }).lean();
      if (reg && reg.lastSeenAt) {
        const ageMs = Date.now() - new Date(reg.lastSeenAt).getTime();
        if (ageMs < 90000) {  // seen within last 90s → treat as alive
          console.log(`[Connector] ${connectorId} — Socket.IO gap but lastSeenAt ${Math.round(ageMs/1000)}s ago → treating as alive, enqueuing job directly`);
          connectorAlive = true;
        }
      }
    } catch (dbErr) {
      console.warn(`[Connector] lastSeenAt DB check failed (non-fatal): ${dbErr.message}`);
    }
  }

  if (!connectorAlive) {
    // Neither Socket.IO nor recent HTTP poll — wait up to 60s for reconnect
    console.warn(`[Connector] ${connectorId} not online — waiting up to 60s for reconnect...`);
    const c = await waitForConnector(connectorId, 60000);
    if (!c || !c.online) {
      throw new Error(`Connector ${connectorId} is not online`);
    }
  }

  // Enqueue the job — connector will pick it up via HTTP poll and POST result back
  return enqueueConnectorJob(connectorId, xml, timeoutMs);
}

// Get status of all connectors
export function getConnectorStatuses() {
  const statuses = [];
  for (const [id, info] of connectedConnectors.entries()) {
    statuses.push({
      connectorId: id,
      online: info.online,
      lastSeen: info.lastSeen
    });
  }
  return statuses;
}

// Check if connector is online
export function isConnectorOnline(connectorId) {
  const connector = connectedConnectors.get(connectorId);
  return !!(connector && connector.online);
}
