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
    wallpaper: {
      type: String,
      default: '',
    },
    disappearingDuration: {
      type: Number,
      default: 0, // 0 = off, 86400 = 24h, 604800 = 7d, 7776000 = 90d
    },
  },
  {
    timestamps: true,
  }
);

// Compound index
chatSettingsSchema.index({ userId: 1, chatId: 1 }, { unique: true });

module.exports = mongoose.model('ChatSettings', chatSettingsSchema);
