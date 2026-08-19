const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      select: false, // Don't return password by default
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    avatarUrl: {
      type: String,
      default: '',
    },
    bio: {
      type: String,
      default: 'Hey there! I am using ChatWave.',
      maxLength: 150,
    },
    isOnline: {
      type: Boolean,
      default: false,
    },
    lastSeen: {
      type: Date,
      default: Date.now,
    },
    hideOnlineStatus: {
      type: Boolean,
      default: false,
    },
    blockedUsers: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
    lastSeenVisibility: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'everyone',
    },
    profilePhotoVisibility: {
      type: String,
      enum: ['everyone', 'contacts', 'nobody'],
      default: 'everyone',
    },
    readReceiptsEnabled: {
      type: Boolean,
      default: true,
    },
    twoStepPin: {
      type: String,
      select: false,
    },
    twoStepEnabled: {
      type: Boolean,
      default: false,
    },
    pushSubscription: {
      type: Object,
      default: null,
    },
    resetPasswordToken: {
      type: String,
      select: false,
    },
    resetPasswordExpires: {
      type: Date,
      select: false,
    },
  },
  {
    timestamps: true,
  }
);

userSchema.methods.toJSON = function () {
  const user = this.toObject();
  delete user.password;
  delete user.twoStepPin;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;

  if (!user.avatarUrl) {
    const encodedName = encodeURIComponent(user.name);
    user.avatarUrl = `https://ui-avatars.com/api/?name=${encodedName}&background=6366f1&color=fff&bold=true`;
  }
  return user;
};

module.exports = mongoose.model('User', userSchema);
