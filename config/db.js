const mongoose = require('mongoose');

let cachedConnection = null;

const connectDB = async () => {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (cachedConnection) {
    return cachedConnection;
  }

  const isVercel = process.env.VERCEL || process.env.NODE_ENV === 'production';
  const connStr = process.env.MONGO_URI || 'mongodb+srv://saumypandey745_db_user:A7ydNH5KEFSGDVCE@cluster0.8xtz6u0.mongodb.net/chatvibe';

  if (!connStr && isVercel) {
    const errorMsg = 'MONGO_URI environment variable is not configured in Vercel settings.';
    console.error(`❌ [DATABASE] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  try {
    console.log(`[DATABASE] Connecting to MongoDB Atlas...`);
    cachedConnection = mongoose.connect(connStr, {
      serverSelectionTimeoutMS: 4000,
    });

    const m = await cachedConnection;
    console.log(`✅ [DATABASE] MongoDB Connected: ${m.connection.host}`);
    return m.connection;
  } catch (error) {
    cachedConnection = null;
    console.warn(`⚠️ [DATABASE] Primary MongoDB Atlas connection failed (${error.message}).`);

    // In local development, automatically launch MongoMemoryServer fallback
    if (!isVercel) {
      console.log(`⚡ [DATABASE] Launching MongoMemoryServer for local development...`);
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();

        cachedConnection = mongoose.connect(mongoUri);
        const m = await cachedConnection;
        console.log(`✅ [DATABASE] Local In-Memory MongoDB Connected at: ${mongoUri}`);
        return m.connection;
      } catch (memErr) {
        console.error(`❌ [DATABASE] Memory server failed: ${memErr.message}`);
        throw memErr;
      }
    } else {
      throw error;
    }
  }
};

module.exports = connectDB;
