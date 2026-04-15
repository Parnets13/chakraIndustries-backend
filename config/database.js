import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    let mongoUri = process.env.MONGODB_URI;
    
    // Handle password with @ symbol - encode it properly
    if (mongoUri.includes('@') && mongoUri.match(/:[^@]*@[^@]*@/)) {
      // Split by :// to get scheme and rest
      const [scheme, rest] = mongoUri.split('://');
      // Find username and password part
      const parts = rest.split('@');
      if (parts.length > 2) {
        // Reconstruct with encoded password
        const username = parts[0].split(':')[0];
        const password = parts.slice(0, -1).join('@'); // Everything except last part
        const host = parts[parts.length - 1];
        mongoUri = `${scheme}://${username}:${encodeURIComponent(password)}@${host}`;
      }
    }
    
    await mongoose.connect(mongoUri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    console.warn('Continuing without database connection...');
    // Don't exit - allow server to run
  }
};

export default connectDB;
