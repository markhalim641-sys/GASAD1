
import mongoose from 'mongoose';

export async function connectDB() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing from .env');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    console.log('MongoDB connected successfully!');
    console.log('Database:', mongoose.connection.name);
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    throw error;
  }
}
