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

const PORT = process.env.PORT || 5000;

const allowedOrigins = [
  'https://chatwave-blond.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.CLIENT_URL,
].filter(Boolean);

// Security Headers with Helmet
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS configuration allowing https://chatwave-blond.vercel.app and Vercel domains
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Body Parsers & Cookie Parser
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));
app.use(cookieParser());

// Serve static uploads directory
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Healthcheck Route
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'ChatWave Master Backend API is running smoothly' });
});

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'ChatWave Master Backend API' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/statuses', statusRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/chat-settings', chatSettingsRoutes);

// Centralized Error Handling Middleware
app.use(errorHandler);

// Connect DB and Start HTTP & Socket Server
connectDB().then(() => {
  if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    server.listen(PORT, () => {
      console.log(`=======================================================`);
      console.log(`🚀 ChatWave Master Server running in ${process.env.NODE_ENV || 'development'} mode`);
      console.log(`🌐 Server listening on http://localhost:${PORT}`);
      console.log(`🔗 Allowed CORS origins: ${allowedOrigins.join(', ')}`);
      console.log(`=======================================================`);
    });
  }
});

module.exports = app;
