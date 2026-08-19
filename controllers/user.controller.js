const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Message = require('../models/Message');
const Group = require('../models/Group');
const ChatSettings = require('../models/ChatSettings');
const { handleImageUpload } = require('../config/cloudinary');

// @desc    Get current user profile
// @route   GET /api/users/profile
// @access  Private
const getProfile = async (req, res, next) => {
  try {
    res.status(200).json({
      success: true,
      user: req.user,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update profile (name, bio, avatar)
// @route   PUT /api/users/profile
// @access  Private
const updateProfile = async (req, res, next) => {
  try {
    const { name, bio } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (name) user.name = name.trim();
    if (bio !== undefined) user.bio = bio.trim();

    if (req.file) {
      const avatarUrl = await handleImageUpload(req.file, req);
      if (avatarUrl) {
        user.avatarUrl = avatarUrl;
      }
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update account settings (change password, toggle online visibility)
// @route   PUT /api/users/settings
// @access  Private
const updateSettings = async (req, res, next) => {
  try {
    const { currentPassword, newPassword, hideOnlineStatus } = req.body;
    const user = await User.findById(req.user._id).select('+password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (typeof hideOnlineStatus === 'boolean') {
      user.hideOnlineStatus = hideOnlineStatus;
    }

    if (newPassword) {
      if (user.authProvider === 'google' && !user.password) {
        return res.status(400).json({
          success: false,
          message: 'Google accounts cannot set local passwords here.',
        });
      }

      if (!currentPassword) {
        return res.status(400).json({
          success: false,
          message: 'Current password is required to change password.',
        });
      }

      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(400).json({
          success: false,
          message: 'Current password is incorrect.',
        });
      }

      const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
      if (!passwordRegex.test(newPassword)) {
        return res.status(400).json({
          success: false,
          message:
            'New password must be at least 8 characters with at least 1 uppercase letter, 1 number, and 1 special character.',
        });
      }

      const salt = await bcrypt.genSalt(10);
      user.password = await bcrypt.hash(newPassword, salt);
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Account settings updated successfully',
      user: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Search registered users by name or email
// @route   GET /api/users/search?q=query
// @access  Private
const searchUsers = async (req, res, next) => {
  try {
    const query = req.query.q || '';
    if (!query.trim()) {
      return res.status(200).json({ success: true, users: [] });
    }

    const regex = new RegExp(query.trim(), 'i');

    const users = await User.find({
      _id: { $ne: req.user._id },
      $or: [{ name: regex }, { email: regex }],
    })
      .select('name email avatarUrl bio isOnline lastSeen hideOnlineStatus')
      .limit(20);

    const formattedUsers = users.map((u) => u.toJSON());

    res.status(200).json({
      success: true,
      users: formattedUsers,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get contacts & group chats list for current user
// @route   GET /api/users/contacts
// @access  Private
const getContacts = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // 1. Get 1-on-1 Messages
    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .populate('senderId', 'name email avatarUrl bio isOnline lastSeen hideOnlineStatus')
      .populate('receiverId', 'name email avatarUrl bio isOnline lastSeen hideOnlineStatus');

    const contactsMap = new Map();

    for (const msg of messages) {
      if (msg.isGroup) continue;

      const isSender = msg.senderId?._id?.toString() === userId.toString();
      const contactUser = isSender ? msg.receiverId : msg.senderId;

      if (!contactUser || !contactUser._id) continue;
      const contactId = contactUser._id.toString();

      if (!contactsMap.has(contactId)) {
        contactsMap.set(contactId, {
          user: contactUser.toJSON ? contactUser.toJSON() : contactUser,
          isGroup: false,
          lastMessage: {
            _id: msg._id,
            text: msg.deletedForEveryone ? 'This message was deleted' : msg.text,
            type: msg.type,
            imageUrl: msg.imageUrl,
            senderId: msg.senderId?._id,
            receiverId: msg.receiverId?._id,
            status: msg.status,
            createdAt: msg.createdAt,
          },
          unreadCount: 0,
        });
      }
    }

    for (const [contactId, contactData] of contactsMap.entries()) {
      const unreadCount = await Message.countDocuments({
        senderId: contactId,
        receiverId: userId,
        status: { $ne: 'read' },
        deletedFor: { $ne: userId },
      });
      contactData.unreadCount = unreadCount;
    }

    // 2. Get Group Chats involving current user
    const groups = await Group.find({ 'members.userId': userId }).populate(
      'members.userId',
      'name avatarUrl isOnline'
    );

    const groupList = [];
    for (const group of groups) {
      const lastMsg = await Message.findOne({
        chatId: group._id.toString(),
        deletedFor: { $ne: userId },
      }).sort({ createdAt: -1 });

      const unreadCount = await Message.countDocuments({
        chatId: group._id.toString(),
        senderId: { $ne: userId },
        status: { $ne: 'read' },
        deletedFor: { $ne: userId },
      });

      groupList.push({
        group: group.toJSON(),
        isGroup: true,
        lastMessage: lastMsg
          ? {
              _id: lastMsg._id,
              text: lastMsg.deletedForEveryone ? 'This message was deleted' : lastMsg.text,
              type: lastMsg.type,
              imageUrl: lastMsg.imageUrl,
              senderId: lastMsg.senderId,
              createdAt: lastMsg.createdAt,
            }
          : null,
        unreadCount,
      });
    }

    const contactsList = Array.from(contactsMap.values());

    res.status(200).json({
      success: true,
      contacts: contactsList,
      groups: groupList,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Block or Unblock a user
// @route   POST /api/users/block/:targetUserId
// @access  Private
const toggleBlockUser = async (req, res, next) => {
  try {
    const { targetUserId } = req.params;
    const userId = req.user._id;

    const user = await User.findById(userId);
    const index = user.blockedUsers.indexOf(targetUserId);

    let isBlocked = false;
    if (index > -1) {
      user.blockedUsers.splice(index, 1);
    } else {
      user.blockedUsers.push(targetUserId);
      isBlocked = true;
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: isBlocked ? 'User blocked' : 'User unblocked',
      isBlocked,
      blockedUsers: user.blockedUsers,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get list of blocked users
// @route   GET /api/users/blocked
// @access  Private
const getBlockedUsers = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate(
      'blockedUsers',
      'name email avatarUrl'
    );
    res.status(200).json({ success: true, blockedUsers: user.blockedUsers });
  } catch (error) {
    next(error);
  }
};

// @desc    Update privacy settings (last seen, profile photo, read receipts)
// @route   PUT /api/users/privacy
// @access  Private
const updatePrivacySettings = async (req, res, next) => {
  try {
    const { lastSeenVisibility, profilePhotoVisibility, readReceiptsEnabled } = req.body;
    const user = await User.findById(req.user._id);

    if (lastSeenVisibility) user.lastSeenVisibility = lastSeenVisibility;
    if (profilePhotoVisibility) user.profilePhotoVisibility = profilePhotoVisibility;
    if (typeof readReceiptsEnabled === 'boolean') user.readReceiptsEnabled = readReceiptsEnabled;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Privacy settings updated',
      user: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Setup or verify 2-Step PIN
// @route   POST /api/users/two-step-pin
// @access  Private
const setupTwoStepPin = async (req, res, next) => {
  try {
    const { pin, action } = req.body; // action: 'setup', 'disable', 'verify'
    const user = await User.findById(req.user._id).select('+twoStepPin');

    if (action === 'disable') {
      user.twoStepPin = undefined;
      user.twoStepEnabled = false;
      await user.save();
      return res.status(200).json({ success: true, message: 'Two-step verification disabled' });
    }

    if (!pin || pin.length !== 4) {
      return res.status(400).json({ success: false, message: '4-digit PIN is required' });
    }

    if (action === 'verify') {
      if (!user.twoStepPin) {
        return res.status(400).json({ success: false, message: 'Two-step verification not enabled' });
      }
      const isMatch = await bcrypt.compare(pin, user.twoStepPin);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Incorrect PIN' });
      }
      return res.status(200).json({ success: true, message: 'PIN verified successfully' });
    }

    // Setup action
    const salt = await bcrypt.genSalt(10);
    user.twoStepPin = await bcrypt.hash(pin, salt);
    user.twoStepEnabled = true;
    await user.save();

    res.status(200).json({ success: true, message: 'Two-step verification enabled successfully' });
  } catch (error) {
    next(error);
  }
};

// @desc    Save Web Push Subscription
// @route   POST /api/users/push-subscription
// @access  Private
const savePushSubscription = async (req, res, next) => {
  try {
    const { subscription } = req.body;
    await User.findByIdAndUpdate(req.user._id, { pushSubscription: subscription });
    res.status(200).json({ success: true, message: 'Push subscription saved' });
  } catch (error) {
    next(error);
  }
};

// @desc    Export chat history as JSON backup
// @route   GET /api/users/export-chat/:chatId
// @access  Private
const exportChatHistory = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const messages = await Message.find({
      $or: [
        { chatId },
        { senderId: userId, receiverId: chatId },
        { senderId: chatId, receiverId: userId },
      ],
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: 1 })
      .populate('senderId', 'name email');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=ChatWave_Export_${chatId}.json`);

    res.status(200).send(JSON.stringify(messages, null, 2));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updateSettings,
  searchUsers,
  getContacts,
  toggleBlockUser,
  getBlockedUsers,
  updatePrivacySettings,
  setupTwoStepPin,
  savePushSubscription,
  exportChatHistory,
};
