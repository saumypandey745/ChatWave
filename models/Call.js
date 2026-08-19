const mongoose = require('mongoose');

const callSchema = new mongoose.Schema(
  {
    callerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['voice', 'video'],
      default: 'voice',
    },
    status: {
      type: String,
      enum: ['missed', 'answered', 'declined'],
      default: 'missed',
    },
    duration: {
      type: Number,
      default: 0, // duration in seconds
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    endedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Call', callSchema);
