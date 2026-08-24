const mongoose = require('mongoose');

const groupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Group name is required'],
      trim: true,
      maxLength: 50,
    },
    iconUrl: {
      type: String,
      default: '',
    },
    description: {
      type: String,
      default: 'Welcome to our group chat!',
      maxLength: 250,
    },
    members: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
          required: true,
        },
        role: {
          type: String,
          enum: ['admin', 'member'],
          default: 'member',
        },
        joinedAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    disappearingDuration: {
      type: Number,
      default: 0, // 0 = off, 86400 = 24h, 604800 = 7d, 7776000 = 90d
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
    requiresAdminApproval: {
      type: Boolean,
      default: false,
    },
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
    },
    isAnnouncementsGroup: {
      type: Boolean,
      default: false,
    },
    isOpenToJoin: {
      type: Boolean,
      default: true,
    },
    pendingMembers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    permissions: {
      sendMessages: {
        type: String,
        enum: ['everyone', 'admins'],
        default: 'everyone',
      },
      editGroupInfo: {
        type: String,
        enum: ['everyone', 'admins'],
        default: 'everyone',
      },
    },
  },
  {
    timestamps: true,
  }
);

groupSchema.methods.toJSON = function () {
  const group = this.toObject();
  if (!group.iconUrl) {
    const encodedName = encodeURIComponent(group.name);
    group.iconUrl = `https://ui-avatars.com/api/?name=${encodedName}&background=4f46e5&color=fff&bold=true`;
  }
  return group;
};

module.exports = mongoose.model('Group', groupSchema);
