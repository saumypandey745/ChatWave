const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    chatId: {
      type: String,
      required: true,
      index: true,
    },
    isGroup: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'call-log', 'system', 'poll', 'sticker', 'gif'],
      default: 'text',
    },
    text: {
      type: String,
      default: '',
    },
    imageUrl: {
      type: String,
      default: '',
    },
    isSticker: {
      type: Boolean,
      default: false,
    },
    isGif: {
      type: Boolean,
      default: false,
    },
    replyTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      default: null,
    },
    reactions: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        emoji: String,
      },
    ],
    forwarded: {
      type: Boolean,
      default: false,
    },
    forwardCount: {
      type: Number,
      default: 0,
    },
    starredBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    mentions: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    fileData: {
      url: String,
      name: String,
      size: Number,
      mimeType: String,
    },
    locationData: {
      latitude: Number,
      longitude: Number,
      address: String,
      isLive: { type: Boolean, default: false },
      liveDuration: { type: Number, default: 0 },
      liveExpiresAt: { type: Date, default: null },
      isEnded: { type: Boolean, default: false },
    },
    contactData: {
      name: String,
      email: String,
      phone: String,
    },
    callLog: {
      callId: String,
      callType: String,
      status: String,
      duration: Number,
    },
    linkPreview: {
      url: String,
      title: String,
      description: String,
      image: String,
    },
    poll: {
      question: { type: String, default: '' },
      options: [
        {
          text: { type: String, required: true },
          votes: [
            {
              type: mongoose.Schema.Types.ObjectId,
              ref: 'User',
            },
          ],
        },
      ],
      allowMultiple: { type: Boolean, default: false },
      endedAt: { type: Date, default: null },
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    editedAt: {
      type: Date,
      default: null,
    },
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    deletedForEveryone: {
      type: Boolean,
      default: false,
    },
    expiresAt: {
      type: Date,
      index: { expires: 0 }, // TTL index for disappearing messages
    },
    isViewOnce: {
      type: Boolean,
      default: false,
    },
    viewOnceState: {
      type: String,
      enum: ['pending', 'opened'],
      default: 'pending',
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
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
