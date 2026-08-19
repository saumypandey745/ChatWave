const mongoose = require('mongoose');

const connectDB = async () => {
  const isVercel = process.env.VERCEL || process.env.NODE_ENV === 'production';
  const connStr = process.env.MONGO_URI || (!isVercel ? 'mongodb://localhost:27017/chatwave' : null);

  if (!connStr) {
    console.error(
      '❌ CRITICAL ERROR: MONGO_URI environment variable is missing on Vercel.\n' +
      'Please add MONGO_URI (e.g. MongoDB Atlas connection string) in your Vercel Project Settings -> Environment Variables.'
    );
    throw new Error('MONGO_URI is not defined in Vercel Environment Variables');
  }

  try {
    console.log(`Connecting to MongoDB Atlas...`);
    await mongoose.connect(connStr, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log(`✅ MongoDB Connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.error(`MongoDB connection failed: ${error.message}`);
    
    // Memory server fallback ONLY in local development
    if (!isVercel) {
      console.warn(`Launching MongoDB Memory Server for local development...`);
      try {
        const { MongoMemoryServer } = require('mongodb-memory-server');
        const mongoServer = await MongoMemoryServer.create();
        const mongoUri = mongoServer.getUri();

        await mongoose.connect(mongoUri);
        console.log(`MongoDB Memory Server Connected at: ${mongoUri}`);
      } catch (memError) {
        console.error(`MongoDB Memory Server failed: ${memError.message}`);
        process.exit(1);
      }
    } else {
      throw error;
    }
  }
};

module.exports = connectDB;
