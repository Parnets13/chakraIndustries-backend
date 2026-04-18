import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error('MONGO_URI is not defined in environment variables');
    }

    const trimmedUri = mongoUri.trim();
    console.log('Connecting to MongoDB, URI starts with:', trimmedUri.substring(0, 20));

    await mongoose.connect(trimmedUri);
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection error:', error.message);
    console.warn('Continuing without database connection...');
  }
};

export default connectDB;
