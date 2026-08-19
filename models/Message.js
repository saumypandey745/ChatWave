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
      enum: ['text', 'image', 'video', 'audio', 'document', 'location', 'contact', 'call-log', 'system'],
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
  },
  {
    timestamps: true,
  }
);

messageSchema.index({ chatId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
