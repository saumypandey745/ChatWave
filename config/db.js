const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const connStr = process.env.MONGO_URI || 'mongodb://localhost:27017/chatwave';
    console.log(`Connecting to MongoDB at ${connStr}...`);
    
    // Set connection options with timeout to fail fast if no local server
    await mongoose.connect(connStr, {
      serverSelectionTimeoutMS: 3000,
    });
    
    console.log(`MongoDB Connected: ${mongoose.connection.host}`);
  } catch (error) {
    console.warn(`Primary MongoDB connection failed (${error.message}). Launching MongoDB Memory Server...`);
    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      const mongoServer = await MongoMemoryServer.create();
      const mongoUri = mongoServer.getUri();
      
      await mongoose.connect(mongoUri);
      console.log(`MongoDB Memory Server Connected successfully at: ${mongoUri}`);
    } catch (memError) {
      console.error(`MongoDB Memory Server failed to launch: ${memError.message}`);
      process.exit(1);
    }
  }
};

module.exports = connectDB;
