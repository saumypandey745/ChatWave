const mongoose = require('mongoose');

const communitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: '',
    },
    iconUrl: {
      type: String,
      default: 'https://cdn-icons-png.flaticon.com/512/33/33308.png',
    },
    creatorId: {
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
    communityAdmins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    pendingMembers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    groups: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Group',
      },
    ],
    announcementsGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Group',
    },
    settings: {
      whoCanAddGroups: {
        type: String,
        enum: ['admins', 'everyone'],
        default: 'admins',
      },
      requiresApproval: {
        type: Boolean,
        default: false,
      },
      whoCanInvite: {
        type: String,
        enum: ['admins', 'everyone'],
        default: 'everyone',
      },
    },
    inviteCode: {
      type: String,
      unique: true,
      sparse: true,
    },
    inviteRevoked: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model('Community', communitySchema);
