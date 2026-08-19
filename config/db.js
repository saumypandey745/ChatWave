const mongoose = require('mongoose');

let isConnected = false;

const connectDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    return;
  }

  const connStr = process.env.MONGO_URI || 'mongodb://localhost:27017/chatwave';

  if (!process.env.MONGO_URI && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
    console.error('❌ MONGO_URI is missing in Vercel Environment Variables');
    throw new Error('MONGO_URI environment variable is missing on Vercel');
  }

  try {
    console.log('Connecting to MongoDB database...');
    const db = await mongoose.connect(connStr, {
      serverSelectionTimeoutMS: 5000,
    });
    isConnected = db.connections[0].readyState === 1;
    console.log(`✅ MongoDB Connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.error(`❌ MongoDB Connection Error: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
