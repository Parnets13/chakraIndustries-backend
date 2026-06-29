import { Server } from 'socket.io';
import crypto from 'crypto';
import TallyConfig from '../models/TallyConfig.js';

// In-memory store for connected connectors
const connectedConnectors = new Map(); // key: connectorId, value: { socket, lastSeen }

// Pending requests map for async responses
const pendingRequests = new Map(); // key: requestId, value: { resolve, reject, timeout }

let io = null;

// Initialize Socket.IO server
export function initConnectorServer(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
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
    console.log(`[Connector] Connected: ${socket.connectorId}`);
    
    // Track connector
    connectedConnectors.set(socket.connectorId, {
      socket,
      lastSeen: new Date(),
      online: true
    });

    // Update TallyConfig connection status
    await TallyConfig.findOneAndUpdate(
      { connectorId: socket.connectorId },
      { connectionStatus: 'Connected' }
    );

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

    socket.on('disconnect', async () => {
      console.log(`[Connector] Disconnected: ${socket.connectorId}`);
      
      // Update connector status
      if (connectedConnectors.has(socket.connectorId)) {
        connectedConnectors.get(socket.connectorId).online = false;
      }

      await TallyConfig.findOneAndUpdate(
        { connectorId: socket.connectorId },
        { connectionStatus: 'Disconnected' }
      );
    });
  });

  return io;
}

// Send XML request to specific connector
export async function sendTallyRequest(connectorId, xml, timeoutMs = 60000) {
  const connector = connectedConnectors.get(connectorId);
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

    pendingRequests.set(requestId, { resolve, reject, timeout });

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
  return connector && connector.online;
}
