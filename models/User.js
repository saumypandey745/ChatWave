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
    chatwaveId: {
      type: String,
      unique: true,
      index: true,
      sparse: true,
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
    statusPrivacy: {
      mode: {
        type: String,
        enum: ['contacts', 'contacts_except', 'only_share_with'],
        default: 'contacts',
      },
      exceptions: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
      ],
    },
    mutedStatusUsers: [
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
    isEmailVerified: {
      type: Boolean,
      default: false,
    },
    emailVerificationCodeHash: {
      type: String,
      select: false,
    },
    emailVerificationCodeExpires: {
      type: Date,
      select: false,
    },
    resetOtpHash: {
      type: String,
      select: false,
    },
    resetOtpExpires: {
      type: Date,
      select: false,
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
  delete user.emailVerificationCodeHash;
  delete user.emailVerificationCodeExpires;
  delete user.resetOtpHash;
  delete user.resetOtpExpires;
  delete user.resetPasswordToken;
  delete user.resetPasswordExpires;

  if (!user.avatarUrl) {
    const encodedName = encodeURIComponent(user.name);
    user.avatarUrl = `https://ui-avatars.com/api/?name=${encodedName}&background=6366f1&color=fff&bold=true`;
  }
  return user;
};

module.exports = mongoose.model('User', userSchema);
