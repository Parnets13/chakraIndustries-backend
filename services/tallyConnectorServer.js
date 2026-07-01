import { Server } from 'socket.io';
import crypto from 'crypto';
import TallyConfig from '../models/TallyConfig.js';

// In-memory store for connected connectors
const connectedConnectors = new Map(); // key: connectorId, value: { socket, lastSeen }

// Pending requests map for async responses
const pendingRequests = new Map(); // key: requestId, value: { resolve, reject, timeout, connectorId, xml }

let io = null;

// Initialize Socket.IO server
export function initConnectorServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    },
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

      // Verify against TallyConfig
      const cfg = await TallyConfig.findOne({ connectorId });
      if (!cfg || cfg.connectorSecret !== connectorSecret) {
        return next(new Error('Invalid credentials'));
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
    
    // Track connector
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

    // Handle tally-response from connector
    socket.on('tally-response', (response) => {
      const { id, success, data, error } = response;
      
      if (pendingRequests.has(id)) {
        const { resolve, reject, timeout } = pendingRequests.get(id);
        clearTimeout(timeout);
        pendingRequests.delete(id);
        
        if (success) {
          resolve(data);
        } else {
          reject(new Error(error || 'Connector error'));
        }
      }
    });

    socket.on('disconnect', async (reason) => {
      console.log(`[Connector] Socket.IO disconnected: ${socket.connectorId} — reason: ${reason}`);
      
      // Update connector status
      if (connectedConnectors.has(socket.connectorId)) {
        connectedConnectors.get(socket.connectorId).online = false;
      }

      // ── Fail all pending requests for this connector immediately ──────────
      // Without this, inflight requests hang until their timeout fires (up to 10 min).
      // postXmlWithRetry will catch the error and retry on the new socket after reconnect.
      for (const [reqId, pending] of pendingRequests.entries()) {
        if (pending.connectorId === socket.connectorId) {
          console.warn(`[Connector] Failing inflight request ${reqId} due to disconnect — will be retried`);
          clearTimeout(pending.timeout);
          pendingRequests.delete(reqId);
          pending.reject(new Error(`Connector disconnected (${reason}) — request will retry`));
        }
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

// Send XML request to specific connector
export async function sendTallyRequest(connectorId, xml, timeoutMs = 60000) {
  let connector = connectedConnectors.get(connectorId);
  if (!connector || !connector.online) {
    // Connector not in Map yet — could be a Render restart. Wait up to 60 s for reconnect.
    console.warn(`[Connector] ${connectorId} not online — waiting up to 60s for reconnect...`);
    connector = await waitForConnector(connectorId, 60000);
  }
  if (!connector || !connector.online) {
    throw new Error(`Connector ${connectorId} is not online`);
  }

  const requestId = crypto.randomUUID();
  
  return new Promise((resolve, reject) => {
    // Set timeout
    const timeout = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timed out'));
      }
    }, timeoutMs);

    // Store connectorId + xml so the disconnect handler can fail fast and
    // postXmlWithRetry can retry with the same XML on the new socket.
    pendingRequests.set(requestId, { resolve, reject, timeout, connectorId, xml });

    // Send request to connector
    connector.socket.emit('tally-request', {
      id: requestId,
      xml
    });
  });
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
