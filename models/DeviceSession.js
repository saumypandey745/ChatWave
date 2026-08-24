const mongoose = require('mongoose');

const deviceSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    deviceToken: {
      type: String,
      required: true,
      unique: true,
    },
    deviceName: {
      type: String,
      default: 'Web Browser',
    },
    ipAddress: {
      type: String,
      default: '127.0.0.1',
    },
    lastActive: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('DeviceSession', deviceSessionSchema);
