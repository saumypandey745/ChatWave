const { Server } = require('socket.io');
const http = require('http');
const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { saveCallRecord } = require('../controllers/call.controller');

const app = express();
const server = http.createServer(app);

const allowedOrigins = [
  'https://chatwave-blond.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000',
  process.env.CLIENT_URL,
].filter(Boolean);

const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    credentials: true,
  },
});

// Map of userId -> Array of socketIds
const userSocketMap = {};

// Active Call Session tracking: callId/pairKey -> { callerId, receiverId, callType, startedAt, connectedAt, timeoutTimer }
const activeCalls = new Map();

const getReceiverSocketId = (receiverId) => {
  return userSocketMap[receiverId] || [];
};

const getCallKey = (userA, userB) => {
  return [userA.toString(), userB.toString()].sort().join('_');
};

// Socket.io Middleware for JWT authentication
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      return next(new Error('Authentication error: No token provided'));
    }

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET || 'fallback_jwt_secret'
    );

    const user = await User.findById(decoded.userId).select('-password');
    if (!user) {
      return next(new Error('Authentication error: User not found'));
    }

    socket.user = user;
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const userId = socket.user._id.toString();
  console.log(`Socket connected: ${socket.id} (User: ${socket.user.name})`);

  if (!userSocketMap[userId]) {
    userSocketMap[userId] = [];
  }
  userSocketMap[userId].push(socket.id);

  // Join personal user room
  socket.join(`user:${userId}`);

  // Update online status in database
  await User.findByIdAndUpdate(userId, { isOnline: true });

  // Broadcast online users
  const onlineUsers = Object.keys(userSocketMap).filter(
    (id) => userSocketMap[id] && userSocketMap[id].length > 0
  );
  io.emit('getOnlineUsers', onlineUsers);

  // Join Group Room
  socket.on('joinGroup', ({ groupId }) => {
    socket.join(`group:${groupId}`);
  });

  // Leave Group Room
  socket.on('leaveGroup', ({ groupId }) => {
    socket.leave(`group:${groupId}`);
  });

  // Typing event
  socket.on('typing', ({ receiverId, groupId }) => {
    if (groupId) {
      socket.to(`group:${groupId}`).emit('userTyping', { senderId: userId, groupId });
    } else if (receiverId) {
      const receiverSockets = getReceiverSocketId(receiverId);
      receiverSockets.forEach((sId) => {
        io.to(sId).emit('userTyping', { senderId: userId });
      });
    }
  });

  // Stop typing event
  socket.on('stopTyping', ({ receiverId, groupId }) => {
    if (groupId) {
      socket.to(`group:${groupId}`).emit('userStoppedTyping', { senderId: userId, groupId });
    } else if (receiverId) {
      const receiverSockets = getReceiverSocketId(receiverId);
      receiverSockets.forEach((sId) => {
        io.to(sId).emit('userStoppedTyping', { senderId: userId });
      });
    }
  });

  // ==========================================
  // WebRTC Signaling Handlers & Call Persistence
  // ==========================================

  // 1. Call Offer (Initiate call)
  socket.on('call-offer', ({ toUserId, offer, callType }) => {
    const receiverSockets = getReceiverSocketId(toUserId);
    const callKey = getCallKey(userId, toUserId);

    // Clear any previous pending call timer for this pair
    if (activeCalls.has(callKey)) {
      clearTimeout(activeCalls.get(callKey).timeoutTimer);
      activeCalls.delete(callKey);
    }

    // Set 30s missed call timeout timer
    const timeoutTimer = setTimeout(async () => {
      console.log(`Call timed out (Missed): ${userId} -> ${toUserId}`);
      activeCalls.delete(callKey);

      // Save Missed Call to DB
      const callRecord = await saveCallRecord({
        callerId: userId,
        receiverId: toUserId,
        type: callType,
        status: 'missed',
        duration: 0,
      });

      // Emit missed call log update to both users
      if (callRecord) {
        [userId, toUserId].forEach((uId) => {
          const userSockets = getReceiverSocketId(uId);
          userSockets.forEach((sId) => {
            io.to(sId).emit('new-call-log', callRecord);
            io.to(sId).emit('call-ended', { byUserId: userId, duration: 0 });
          });
        });
      }
    }, 30000);

    activeCalls.set(callKey, {
      callerId: userId,
      receiverId: toUserId,
      callType: callType || 'voice',
      startedAt: new Date(),
      connectedAt: null,
      timeoutTimer,
    });

    receiverSockets.forEach((sId) => {
      io.to(sId).emit('incoming-call-offer', {
        fromUser: {
          _id: userId,
          name: socket.user.name,
          avatarUrl: socket.user.avatarUrl,
        },
        offer,
        callType,
      });
    });
  });

  // 2. Call Answer (Call accepted)
  socket.on('call-answer', ({ toUserId, answer }) => {
    const callKey = getCallKey(userId, toUserId);
    const activeCall = activeCalls.get(callKey);

    if (activeCall) {
      clearTimeout(activeCall.timeoutTimer);
      activeCall.connectedAt = new Date();
    }

    const callerSockets = getReceiverSocketId(toUserId);
    callerSockets.forEach((sId) => {
      io.to(sId).emit('call-answered', { answer });
    });
  });

  // 3. ICE Candidate Exchange
  socket.on('ice-candidate', ({ toUserId, candidate }) => {
    const receiverSockets = getReceiverSocketId(toUserId);
    receiverSockets.forEach((sId) => {
      io.to(sId).emit('remote-ice-candidate', { candidate });
    });
  });

  // 4. Call Decline (Callee rejects call)
  socket.on('call-decline', async ({ toUserId }) => {
    const callKey = getCallKey(userId, toUserId);
    const activeCall = activeCalls.get(callKey);

    if (activeCall) {
      clearTimeout(activeCall.timeoutTimer);
      activeCalls.delete(callKey);
    }

    const callerId = activeCall ? activeCall.callerId : toUserId;
    const receiverId = activeCall ? activeCall.receiverId : userId;
    const cType = activeCall ? activeCall.callType : 'voice';

    // Persist Declined Call to DB
    const callRecord = await saveCallRecord({
      callerId,
      receiverId,
      type: cType,
      status: 'declined',
      duration: 0,
    });

    // Notify caller that call was declined
    const callerSockets = getReceiverSocketId(toUserId);
    callerSockets.forEach((sId) => {
      io.to(sId).emit('call-declined', { byUserId: userId });
    });

    // Emit new call log to both participants
    if (callRecord) {
      [callerId, receiverId].forEach((uId) => {
        const uSockets = getReceiverSocketId(uId);
        uSockets.forEach((sId) => {
          io.to(sId).emit('new-call-log', callRecord);
        });
      });
    }
  });

  // 5. Call End (User hangs up active or calling session)
  socket.on('call-end', async ({ toUserId, duration }) => {
    const callKey = getCallKey(userId, toUserId);
    const activeCall = activeCalls.get(callKey);

    let callerId = userId;
    let receiverId = toUserId;
    let cType = 'voice';
    let calcDuration = duration || 0;

    if (activeCall) {
      clearTimeout(activeCall.timeoutTimer);
      callerId = activeCall.callerId;
      receiverId = activeCall.receiverId;
      cType = activeCall.callType;

      if (activeCall.connectedAt) {
        calcDuration = Math.round((Date.now() - activeCall.connectedAt.getTime()) / 1000);
      }
      activeCalls.delete(callKey);
    }

    const finalStatus = calcDuration > 0 ? 'answered' : 'missed';

    // Persist Call Log to DB
    const callRecord = await saveCallRecord({
      callerId,
      receiverId,
      type: cType,
      status: finalStatus,
      duration: calcDuration,
    });

    // Emit call-ended event
    const recipientSockets = getReceiverSocketId(toUserId);
    recipientSockets.forEach((sId) => {
      io.to(sId).emit('call-ended', { byUserId: userId, duration: calcDuration });
    });

    // Emit new-call-log to both participants in real-time
    if (callRecord) {
      [callerId, receiverId].forEach((uId) => {
        const uSockets = getReceiverSocketId(uId);
        uSockets.forEach((sId) => {
          io.to(sId).emit('new-call-log', callRecord);
        });
      });
    }
  });

  // Disconnect
  socket.on('disconnect', async () => {
    console.log(`Socket disconnected: ${socket.id} (User: ${userId})`);
    if (userSocketMap[userId]) {
      userSocketMap[userId] = userSocketMap[userId].filter((id) => id !== socket.id);
      if (userSocketMap[userId].length === 0) {
        delete userSocketMap[userId];
        await User.findByIdAndUpdate(userId, {
          isOnline: false,
          lastSeen: new Date(),
        });
      }
    }

    const currentOnline = Object.keys(userSocketMap).filter(
      (id) => userSocketMap[id] && userSocketMap[id].length > 0
    );
    io.emit('getOnlineUsers', currentOnline);
  });
});

module.exports = { app, io, server, getReceiverSocketId };
