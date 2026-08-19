const mongoose = require('mongoose');

let cachedConnection = null;

const connectDB = async () => {
  // If connection is already established and active
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  // If a connection attempt is currently in-flight, await it
  if (cachedConnection) {
    return cachedConnection;
  }

  const connStr = process.env.MONGO_URI || 'mongodb+srv://saumypandey745_db_user:A7ydNH5KEFSGDVCE@cluster0.8xtz6u0.mongodb.net/chatvibe';

  if (!process.env.MONGO_URI && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
    const errorMsg = 'MONGO_URI environment variable is not configured in Vercel settings.';
    console.error(`❌ [DATABASE] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    console.log(`[DATABASE] Connecting to MongoDB...`);
    cachedConnection = mongoose.connect(connStr, {
      serverSelectionTimeoutMS: 5000,
    });

    const m = await cachedConnection;
    console.log(`✅ [DATABASE] MongoDB Connected: ${m.connection.host}`);
    return m.connection;
  } catch (error) {
    cachedConnection = null;
    console.error(`❌ [DATABASE] Connection failed: ${error.message}`);
    throw error;
  }
};

module.exports = connectDB;
