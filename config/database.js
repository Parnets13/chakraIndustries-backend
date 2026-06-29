import mongoose from 'mongoose';
import dotenv from 'dotenv';
import dns from 'dns';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend root directory
dotenv.config({ path: path.join(__dirname, '../.env') });

// ── DNS override ──────────────────────────────────────────────────────────────
// Node picks up 127.0.0.1 from Windows resolver stub (VPN / Docker / WSL).
// That loopback stub refuses SRV queries → querySrv ECONNREFUSED.
// Force Node to use Google DNS directly so mongodb+srv:// SRV lookups work.
const currentServers = dns.getServers();
const hasBrokenResolver = currentServers.length === 1 && currentServers[0] === '127.0.0.1';
if (hasBrokenResolver) {
  console.log(`[DB] DNS was ${JSON.stringify(currentServers)} — overriding to 8.8.8.8, 8.8.4.4`);
  dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);
}
console.log('[DB] DNS servers now:', dns.getServers());

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      console.error('✗ MONGO_URI is not defined in environment variables');
      console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('MONGO') || k.includes('mongo')));
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    console.log('[DB] Connecting to MongoDB...');
    console.log('[DB] URI prefix:', mongoUri.substring(0, 60) + '...');

    // ── Try SRV URI first ───────────────────────────────────────────────────
    let connected = false;
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 20000,
        socketTimeoutMS: 60000,
        connectTimeoutMS: 20000,
        heartbeatFrequencyMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 2,
      });
      connected = true;
      console.log('✓ MongoDB connected successfully (SRV)');
    } catch (srvErr) {
      console.warn(`[DB] SRV connection failed: ${srvErr.message}`);
      // ── Fallback: direct non-SRV URI ────────────────────────────────────
      // Atlas shard hosts resolved via PowerShell nslookup
      // replicaSet name from TXT record: atlas-afqyip-shard-0

      // Build clean direct URI (replace query string entirely for safety)
      const uriBase = mongoUri
        .replace('mongodb+srv://', 'mongodb://')
        .replace(/@cluster0\.qgrphvw\.mongodb\.net\/([^?]*).*/, 
          '@ac-peibm7x-shard-00-00.qgrphvw.mongodb.net:27017,' +
          'ac-peibm7x-shard-00-01.qgrphvw.mongodb.net:27017,' +
          'ac-peibm7x-shard-00-02.qgrphvw.mongodb.net:27017/$1' +
          '?ssl=true&authSource=admin&replicaSet=atlas-afqyip-shard-0&retryWrites=true&w=majority');

      console.log('[DB] Trying direct (non-SRV) connection...');
      console.log('[DB] Direct URI prefix:', uriBase.substring(0, 80) + '...');

      await mongoose.connect(uriBase, {
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 60000,
        connectTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 2,
        tls: true,
      });
      connected = true;
      console.log('✓ MongoDB connected successfully (direct)');
    }

    if (!connected) throw new Error('All connection attempts failed');

    // Log connection events for monitoring
    mongoose.connection.on('disconnected', () => {
      console.warn('⚠ MongoDB disconnected — Mongoose will auto-reconnect');
    });
    mongoose.connection.on('reconnected', () => {
      console.log('✓ MongoDB reconnected');
    });
    mongoose.connection.on('error', (err) => {
      console.error('✗ MongoDB connection error:', err.message);
    });

  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    if (error.cause) console.error('   Caused by:', error.cause.message || error.cause);
    console.warn('⚠ Retrying in 5 seconds...');
    setTimeout(() => connectDB(), 5000);
  }
};

export default connectDB;
