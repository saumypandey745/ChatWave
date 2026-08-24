const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const Message = require('../models/Message');
const Group = require('../models/Group');
const Contact = require('../models/Contact');
const ChatSettings = require('../models/ChatSettings');
const Report = require('../models/Report');
const { handleImageUpload } = require('../config/cloudinary');
const generateChatwaveId = require('../utils/generateChatwaveId');

// @desc    Get current user profile
// @route   GET /api/users/profile
// @access  Private
const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    if (user && !user.chatwaveId) {
      user.chatwaveId = await generateChatwaveId();
      await user.save();
    }
    res.status(200).json({
      success: true,
      user: user ? user.toJSON() : req.user,
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

// @desc    Add contact by 10-digit ChatWave ID
// @route   POST /api/users/contacts/add
// @access  Private
const addContact = async (req, res, next) => {
  try {
    const { chatwaveId, nickname } = req.body;
    const userId = req.user._id;

    if (!chatwaveId || !chatwaveId.trim()) {
      return res.status(400).json({ success: false, message: 'ChatWave ID is required' });
    }

    const cleanId = chatwaveId.trim().replace(/\s+/g, '');

    const currentUser = await User.findById(userId);
    if (currentUser.chatwaveId === cleanId) {
      return res.status(400).json({ success: false, message: "You can't add yourself" });
    }

    const targetUser = await User.findOne({ chatwaveId: cleanId });
    if (!targetUser) {
      return res.status(404).json({ success: false, message: 'No ChatWave user found with this ID' });
    }

    const contact = await Contact.findOneAndUpdate(
      { ownerId: userId, contactUserId: targetUser._id },
      { nickname: nickname ? nickname.trim() : '' },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const formattedUser = targetUser.toJSON();
    if (contact.nickname) {
      formattedUser.nickname = contact.nickname;
      formattedUser.displayName = contact.nickname;
    } else {
      formattedUser.displayName = targetUser.name;
    }
    formattedUser.isSavedContact = true;

    res.status(200).json({
      success: true,
      message: 'Contact added successfully',
      contact: {
        user: formattedUser,
        nickname: contact.nickname,
        isSavedContact: true,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update nickname for a saved contact
// @route   PUT /api/users/contacts/:targetUserId/nickname
// @access  Private
const updateContactNickname = async (req, res, next) => {
  try {
    const { targetUserId } = req.params;
    const { nickname } = req.body;
    const userId = req.user._id;

    const contact = await Contact.findOneAndUpdate(
      { ownerId: userId, contactUserId: targetUserId },
      { nickname: nickname ? nickname.trim() : '' },
      { new: true }
    );

    if (!contact) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    res.status(200).json({
      success: true,
      message: 'Contact nickname updated',
      nickname: contact.nickname,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Search ONLY within current user's saved contacts
// @route   GET /api/users/search?q=query
// @access  Private
const searchUsers = async (req, res, next) => {
  try {
    const query = req.query.q || '';
    if (!query.trim()) {
      return res.status(200).json({ success: true, users: [] });
    }

    const userId = req.user._id;
    const cleanIdRegex = new RegExp(query.trim().replace(/\s+/g, ''), 'i');
    const normalRegex = new RegExp(query.trim(), 'i');

    const savedContacts = await Contact.find({ ownerId: userId }).populate(
      'contactUserId',
      'name email avatarUrl bio isOnline lastSeen hideOnlineStatus chatwaveId'
    );

    const matchedUsers = [];
    for (const c of savedContacts) {
      if (!c.contactUserId) continue;
      const u = c.contactUserId;
      const matchesName = normalRegex.test(u.name);
      const matchesEmail = normalRegex.test(u.email);
      const matchesId = u.chatwaveId && cleanIdRegex.test(u.chatwaveId);
      const matchesNickname = c.nickname && normalRegex.test(c.nickname);

      if (matchesName || matchesEmail || matchesId || matchesNickname) {
        const userObj = u.toJSON();
        if (c.nickname) {
          userObj.nickname = c.nickname;
          userObj.name = c.nickname; // Override name for consistent display
        }
        userObj.isSavedContact = true;
        matchedUsers.push(userObj);
      }
    }

    res.status(200).json({
      success: true,
      users: matchedUsers,
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

    // Fetch saved contacts map
    const savedContacts = await Contact.find({ ownerId: userId });
    const savedContactsMap = new Map();
    savedContacts.forEach((c) => {
      savedContactsMap.set(c.contactUserId.toString(), c.nickname || '');
    });

    // 1. Get 1-on-1 Messages
    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .populate('senderId', 'name email avatarUrl bio isOnline lastSeen hideOnlineStatus chatwaveId')
      .populate('receiverId', 'name email avatarUrl bio isOnline lastSeen hideOnlineStatus chatwaveId');

    const contactsMap = new Map();

    // Populate saved contacts first (even if no messages sent yet)
    const savedUsers = await User.find({ _id: { $in: Array.from(savedContactsMap.keys()) } }).select(
      'name email avatarUrl bio isOnline lastSeen hideOnlineStatus chatwaveId'
    );

    for (const sUser of savedUsers) {
      const sId = sUser._id.toString();
      const nickname = savedContactsMap.get(sId);
      const userObj = sUser.toJSON();
      if (nickname) {
        userObj.nickname = nickname;
        userObj.name = nickname;
      }
      userObj.isSavedContact = true;

      contactsMap.set(sId, {
        user: userObj,
        isGroup: false,
        isSavedContact: true,
        nickname,
        lastMessage: null,
        unreadCount: 0,
      });
    }

    // Overlay 1-on-1 message history
    for (const msg of messages) {
      if (msg.isGroup) continue;

      const isSender = msg.senderId?._id?.toString() === userId.toString();
      const contactUser = isSender ? msg.receiverId : msg.senderId;

      if (!contactUser || !contactUser._id) continue;
      const contactId = contactUser._id.toString();

      const isSaved = savedContactsMap.has(contactId);
      const nickname = isSaved ? savedContactsMap.get(contactId) : '';

      const userObj = contactUser.toJSON ? contactUser.toJSON() : contactUser;
      if (nickname) {
        userObj.nickname = nickname;
        userObj.name = nickname;
      }
      userObj.isSavedContact = isSaved;

      const existingData = contactsMap.get(contactId);
      if (!existingData || !existingData.lastMessage) {
        contactsMap.set(contactId, {
          user: userObj,
          isGroup: false,
          isSavedContact: isSaved,
          nickname,
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

    // Include active non-deleted 1-on-1 chats from ChatSettings (e.g. cleared unsaved chats)
    const activeSettings = await ChatSettings.find({ userId, deleted: { $ne: true } });
    for (const setting of activeSettings) {
      const cId = setting.chatId.toString();
      if (!contactsMap.has(cId) && mongoose.Types.ObjectId.isValid(cId)) {
        const isGroup = await Group.exists({ _id: cId });
        if (!isGroup) {
          const targetUser = await User.findById(cId).select(
            'name email avatarUrl bio isOnline lastSeen hideOnlineStatus chatwaveId'
          );
          if (targetUser) {
            const isSaved = savedContactsMap.has(cId);
            const nickname = isSaved ? savedContactsMap.get(cId) : '';
            const userObj = targetUser.toJSON();
            if (nickname) {
              userObj.nickname = nickname;
              userObj.name = nickname;
            }
            userObj.isSavedContact = isSaved;
            contactsMap.set(cId, {
              user: userObj,
              isGroup: false,
              isSavedContact: isSaved,
              nickname,
              lastMessage: null,
              unreadCount: 0,
            });
          }
        }
      }
    }

    // Filter out chats marked as deleted in ChatSettings (unless revived by a newer message)
    const deletedSettings = await ChatSettings.find({ userId, deleted: true });
    const deletedMap = new Map();
    deletedSettings.forEach((ds) => {
      deletedMap.set(ds.chatId.toString(), ds.deletedAt);
    });

    for (const [contactId, contactData] of Array.from(contactsMap.entries())) {
      if (deletedMap.has(contactId)) {
        const deletedAt = deletedMap.get(contactId);
        const lastMsgTime = contactData.lastMessage ? new Date(contactData.lastMessage.createdAt) : null;

        if (!lastMsgTime || (deletedAt && lastMsgTime <= new Date(deletedAt))) {
          if (contactData.isSavedContact) {
            contactData.lastMessage = null;
          } else {
            contactsMap.delete(contactId);
          }
        }
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

// @desc    Block a user explicitly
// @route   POST /api/users/:targetUserId/block
// @access  Private
const blockUser = async (req, res, next) => {
  try {
    const { targetUserId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid target user ID' });
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) return res.status(404).json({ success: false, message: 'User not found' });

    const isAlreadyBlocked = currentUser.blockedUsers.some(
      (bId) => (bId._id || bId).toString() === targetUserId.toString()
    );

    if (!isAlreadyBlocked) {
      currentUser.blockedUsers.push(new mongoose.Types.ObjectId(targetUserId));
      await currentUser.save();
    }

    res.status(200).json({
      success: true,
      message: 'User blocked successfully',
      isBlocked: true,
      blockedUsers: currentUser.blockedUsers,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Unblock a user explicitly
// @route   POST /api/users/:targetUserId/unblock
// @access  Private
const unblockUser = async (req, res, next) => {
  try {
    const { targetUserId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid target user ID' });
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) return res.status(404).json({ success: false, message: 'User not found' });

    currentUser.blockedUsers = currentUser.blockedUsers.filter(
      (bId) => (bId._id || bId).toString() !== targetUserId.toString()
    );

    await currentUser.save();

    res.status(200).json({
      success: true,
      message: 'User unblocked successfully',
      isBlocked: false,
      blockedUsers: currentUser.blockedUsers,
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

    if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
      return res.status(400).json({ success: false, message: 'Invalid target user ID' });
    }

    const currentUser = await User.findById(userId);
    if (!currentUser) return res.status(404).json({ success: false, message: 'User not found' });

    const isCurrentlyBlocked = currentUser.blockedUsers.some(
      (bId) => (bId._id || bId).toString() === targetUserId.toString()
    );

    if (isCurrentlyBlocked) {
      currentUser.blockedUsers = currentUser.blockedUsers.filter(
        (bId) => (bId._id || bId).toString() !== targetUserId.toString()
      );
    } else {
      currentUser.blockedUsers.push(new mongoose.Types.ObjectId(targetUserId));
    }

    await currentUser.save();

    res.status(200).json({
      success: true,
      message: isCurrentlyBlocked ? 'User unblocked successfully' : 'User blocked successfully',
      isBlocked: !isCurrentlyBlocked,
      blockedUsers: currentUser.blockedUsers,
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

// @desc    Update general user settings
// @route   PUT /api/users/settings
// @access  Private
const updateSettings = async (req, res, next) => {
  try {
    const { hideOnlineStatus, lastSeenVisibility, profilePhotoVisibility, readReceiptsEnabled, language } = req.body;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (typeof hideOnlineStatus === 'boolean') user.hideOnlineStatus = hideOnlineStatus;
    if (lastSeenVisibility) user.lastSeenVisibility = lastSeenVisibility;
    if (profilePhotoVisibility) user.profilePhotoVisibility = profilePhotoVisibility;
    if (typeof readReceiptsEnabled === 'boolean') user.readReceiptsEnabled = readReceiptsEnabled;
    if (language) user.language = language;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      user: user.toJSON(),
    });
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
// @desc    Report a contact/user
// @route   POST /api/users/:targetUserId/report
// @access  Private
const reportUser = async (req, res, next) => {
  try {
    const { targetUserId } = req.params;
    const { reason } = req.body;
    const reporterId = req.user._id;

    const report = await Report.create({
      reporterId,
      targetId: targetUserId,
      targetType: 'user',
      reason: reason || 'Reported user for inappropriate content or spam',
    });

    res.status(201).json({
      success: true,
      message: 'Report submitted successfully',
      report,
    });
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

    const formattedExport = messages.map((m) => ({
      messageId: m._id,
      sender: m.senderId?.name || 'Unknown',
      senderEmail: m.senderId?.email || '',
      type: m.type,
      text: m.text,
      imageUrl: m.imageUrl || undefined,
      fileData: m.fileData || undefined,
      locationData: m.locationData || undefined,
      contactData: m.contactData || undefined,
      timestamp: m.createdAt,
    }));

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename=ChatWave_Export_${chatId}.json`);

    res.status(200).send(JSON.stringify(formattedExport, null, 2));
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getProfile,
  updateProfile,
  updateSettings,
  addContact,
  updateContactNickname,
  searchUsers,
  getContacts,
  blockUser,
  unblockUser,
  toggleBlockUser,
  getBlockedUsers,
  updatePrivacySettings,
  setupTwoStepPin,
  savePushSubscription,
  reportUser,
  exportChatHistory,
};
