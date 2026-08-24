const crypto = require('crypto');
const DeviceSession = require('../models/DeviceSession');
const User = require('../models/User');
const generateToken = require('../utils/generateToken');

// In-memory store for active pairing tokens: token -> { userId, expiresAt }
const pairingTokens = new Map();

// Background interval to clean expired pairing tokens every 15s
setInterval(() => {
  const now = Date.now();
  for (const [token, data] of pairingTokens.entries()) {
    if (data.expiresAt < now) {
      pairingTokens.delete(token);
    }
  }
}, 15000);

// @desc    Generate short-lived (60s), single-use QR pairing token
// @route   POST /api/devices/generate-pairing-token
// @access  Private
const generatePairingToken = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Generate random 32-char hex token
    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = Date.now() + 60000; // 60 seconds TTL

    pairingTokens.set(token, {
      userId,
      expiresAt,
    });

    res.status(200).json({
      success: true,
      token,
      expiresIn: 60,
      expiresAt,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Link device by scanning/consuming pairing token (Single-Use Only)
// @route   POST /api/devices/link
// @access  Public (authenticates via single-use pairing token)
const linkDevice = async (req, res, next) => {
  try {
    const { token, deviceName = 'Linked Web Browser' } = req.body;

    if (!token || !pairingTokens.has(token)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired QR pairing token. Please scan a fresh QR code.',
      });
    }

    const pairingData = pairingTokens.get(token);

    // SECURITY CHECK 1: Expiry check
    if (Date.now() > pairingData.expiresAt) {
      pairingTokens.delete(token);
      return res.status(400).json({
        success: false,
        message: 'QR pairing token has expired (60s limit). Please generate a new code.',
      });
    }

    // SECURITY CHECK 2: Single-use consumption (delete token immediately)
    pairingTokens.delete(token);

    const user = await User.findById(pairingData.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Create unique device session token
    const deviceToken = crypto.randomBytes(24).toString('hex');
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

    const session = await DeviceSession.create({
      userId: user._id,
      deviceToken,
      deviceName,
      ipAddress,
      lastActive: new Date(),
    });

    // Generate JWT auth token for newly linked session
    const jwtToken = generateToken(res, user._id);

    res.status(200).json({
      success: true,
      message: 'Device linked successfully',
      token: jwtToken,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        chatwaveId: user.chatwaveId,
      },
      deviceSession: session,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all active linked device sessions for current user
// @route   GET /api/devices
// @access  Private
const getLinkedDevices = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const devices = await DeviceSession.find({ userId }).sort({ lastActive: -1 });

    res.status(200).json({
      success: true,
      devices,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Revoke / Log out a specific linked device session
// @route   DELETE /api/devices/:id
// @access  Private
const revokeDevice = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const device = await DeviceSession.findOneAndDelete({ _id: id, userId });
    if (!device) {
      return res.status(404).json({ success: false, message: 'Linked device session not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Device session revoked successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  generatePairingToken,
  linkDevice,
  getLinkedDevices,
  revokeDevice,
};
