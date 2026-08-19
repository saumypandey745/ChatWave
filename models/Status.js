const mongoose = require('mongoose');

const statusSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'video'],
      default: 'text',
    },
    content: {
      type: String,
      default: '',
      maxLength: 500,
    },
    mediaUrl: {
      type: String,
      default: '',
    },
    backgroundColor: {
      type: String,
      default: '#6366f1',
    },
    font: {
      type: String,
      default: 'sans',
    },
    viewedBy: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        viewedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // Auto delete after 24h
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Status', statusSchema);
