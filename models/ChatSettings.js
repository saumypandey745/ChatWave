const mongoose = require('mongoose');

const chatSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    chatId: {
      type: String,
      required: true,
      index: true,
    },
    pinned: {
      type: Boolean,
      default: false,
    },
    archived: {
      type: Boolean,
      default: false,
    },
    muted: {
      type: Boolean,
      default: false,
    },
    mutedUntil: {
      type: Date,
      default: null,
    },
    muteOption: {
      type: String,
      enum: ['off', '8h', '1w', 'always'],
      default: 'off',
    },
    wallpaper: {
      type: String,
      default: '',
    },
    disappearingDuration: {
      type: Number,
      default: 0, // 0 = off, 86400 = 24h, 604800 = 7d, 7776000 = 90d
    },
    isLocked: {
      type: Boolean,
      default: false,
    },
    lockPin: {
      type: String,
      default: null,
      select: false,
    },
    deleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Compound index
chatSettingsSchema.index({ userId: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model('ChatSettings', chatSettingsSchema);
