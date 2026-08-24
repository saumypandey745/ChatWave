const mongoose = require('mongoose');

const channelSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    handle: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    avatarUrl: {
      type: String,
      default: 'https://cdn-icons-png.flaticon.com/512/3670/3670051.png',
    },
    verified: {
      type: Boolean,
      default: true,
    },
    category: {
      type: String,
      default: 'General',
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    subscribers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    subscriberCount: {
      type: Number,
      default: 1,
    },
    pinnedPostId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ChannelPost',
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Channel', channelSchema);
