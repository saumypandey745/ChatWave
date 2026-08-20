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
  let rawUri = process.env.MONGO_URI || '';

  // Sanitize connection string (strip accidental surrounding quotes and whitespace)
  const connStr = rawUri ? rawUri.trim().replace(/^["']|["']$/g, '').trim() : '';

  if (!connStr) {
    if (isVercel) {
      const errorMsg = 'MONGO_URI environment variable is not configured in project Environment Variables.';
      console.error(`❌ [DATABASE] ${errorMsg}`);
      throw new Error(errorMsg);
    } else {
      console.log(`⚡ [DATABASE] MONGO_URI not set. Launching MongoMemoryServer for local development...`);
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
    }
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
    let hint = '';
    if (error.message.includes('bad auth')) {
      hint = ' (Authentication failed: Check DB username and password in MONGO_URI)';
    } else if (error.message.includes('selection timed out') || error.message.includes('ENOTFOUND')) {
      hint = ' (Network timeout: Ensure IP 0.0.0.0/0 is whitelisted in MongoDB Atlas Network Access)';
    }
    console.warn(`⚠️ [DATABASE] Primary MongoDB connection failed (${error.message}${hint}).`);

    // In local development, automatically launch MongoMemoryServer fallback
    if (!isVercel) {
      console.log(`⚡ [DATABASE] Launching MongoMemoryServer for local development fallback...`);
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
      throw new Error(`MongoDB Connection Failed: ${error.message}${hint}`);
    }
  }
};

module.exports = connectDB;

