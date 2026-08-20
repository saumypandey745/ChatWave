const dotenv = require('dotenv');
dotenv.config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const connectDB = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const messageRoutes = require('./routes/message.routes');
const groupRoutes = require('./routes/group.routes');
const statusRoutes = require('./routes/status.routes');
const callRoutes = require('./routes/call.routes');
const chatSettingsRoutes = require('./routes/chatSettings.routes');

const errorHandler = require('./middleware/errorHandler');
const { app, server } = require('./socket/socket');
const Message = require('./models/Message');

// Background interval to delete expired disappearing messages (runs every 30s)
setInterval(async () => {
  try {
    const res = await Message.deleteMany({ expiresAt: { $lte: new Date() } });
    if (res.deletedCount > 0) {
      console.log(`[DISAPPEARING MESSAGES CLEANUP] Deleted ${res.deletedCount} expired messages.`);
    }
  } catch (err) {
    // Ignore cleanup errors if DB not ready yet
  }
}, 30000);

const PORT = process.env.PORT || 5000;

// Configure Trust Proxy for Reverse Proxies (Vercel / Cloudflare / Ngrok)
app.set('trust proxy', 1);

// Helper function to check if request origin is permitted
const isAllowedOrigin = (origin) => {
  if (!origin) return true; // Non-browser clients (curl, Postman, server-to-server)
  const allowed = [
    'http://localhost:5173',
    'http://localhost:3000',
    'http://localhost:5000',
    process.env.CLIENT_URL,
  ].filter(Boolean);

  if (allowed.includes(origin)) return true;
  if (origin.endsWith('.vercel.app')) return true;
  if (origin.includes('.ngrok-free.dev') || origin.includes('.ngrok.io')) return true;
  return false;
};

// 1. Primary Production-Safe CORS & Preflight Middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;

  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, X-CSRF-Token');
  }

  // Preflight OPTIONS request handler
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  next();
});

// 2. Security Headers with Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// 3. Body & Cookie Parsers
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// Static Uploads Directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// 4. Healthcheck & Root Endpoints
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'ChatWave API is running' });
});

app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'ChatWave Backend Service' });
});

// 5. Database Connection Middleware for Serverless Execution
app.use('/api', async (req, res, next) => {
  try {
    await connectDB();
    next();
  } catch (dbErr) {
    console.error('[DATABASE MIDDLEWARE ERROR]', dbErr.message);
    res.status(500).json({
      success: false,
      message: 'Database connection failed. Ensure MONGO_URI is set in project Environment Variables.',
      error: process.env.NODE_ENV === 'production' ? null : dbErr.message,
    });
  }
});

// 6. API Route Handlers
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/statuses', statusRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/chat-settings', chatSettingsRoutes);

// 7. Centralized Error Handler Middleware
app.use(errorHandler);

// Start HTTP & Socket Server for standalone Web Service (Render / Local Node)
if (!process.env.VERCEL) {
  connectDB()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`=======================================================`);
        console.log(`🚀 ChatWave Server listening on port ${PORT}`);
        console.log(`=======================================================`);
      });
    })
    .catch((err) => {
      console.error('Initial DB connection error:', err.message);
      server.listen(PORT, () => {
        console.log(`🚀 Server started on port ${PORT} (DB Connection pending)`);
      });
    });
}

module.exports = app;
