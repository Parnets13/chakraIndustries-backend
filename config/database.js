import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from backend root directory
dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      console.error('✗ MONGO_URI is not defined in environment variables');
      console.error('Available env vars:', Object.keys(process.env).filter(k => k.includes('MONGO') || k.includes('mongo')));
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    console.log('Connecting to MongoDB...');
    console.log('URI:', mongoUri.substring(0, 50) + '...');

    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 30000, // increased timeout
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      w: 'majority',
      maxPoolSize: 10,
      minPoolSize: 2,
    });
    console.log('✓ MongoDB connected successfully');

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
    console.error('✗ MongoDB connection error:', error.message);
    console.warn('⚠ Continuing without database connection...');
    
    // Retry connection after 5 seconds
    setTimeout(() => {
      console.log('Retrying MongoDB connection...');
      connectDB();
    }, 5000);
  }
};

export default connectDB;
