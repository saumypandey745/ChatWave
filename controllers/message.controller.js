const Message = require('../models/Message');
const User = require('../models/User');
const Group = require('../models/Group');
const ChatSettings = require('../models/ChatSettings');
const { handleImageUpload } = require('../config/cloudinary');
const { getReceiverSocketId, io } = require('../socket/socket');
const ogs = require('open-graph-scraper');

// Helper to extract link previews
const extractLinkPreview = async (text) => {
  if (!text) return null;
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const match = text.match(urlRegex);
  if (!match) return null;

  try {
    const url = match[0];
    const { result } = await ogs({ url, timeout: 3000 });
    if (result && result.ogTitle) {
      return {
        url,
        title: result.ogTitle,
        description: result.ogDescription || '',
        image: result.ogImage?.[0]?.url || result.ogImage?.url || '',
      };
    }
  } catch (e) {
    // Fail silently if URL cannot be scraped
  }
  return null;
};

// @desc    Get paginated messages for 1-on-1 or group chat
// @route   GET /api/messages/:chatId?page=1&limit=20&isGroup=false
// @access  Private
const getMessages = async (req, res, next) => {
  try {
    const currentUserId = req.user._id;
    const { chatId } = req.params;
    const isGroup = req.query.isGroup === 'true';
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '20');
    const skip = (page - 1) * limit;

    let filter = { deletedFor: { $ne: currentUserId } };

    if (isGroup) {
      filter.chatId = chatId;
    } else {
      filter.$or = [
        { chatId },
        { senderId: currentUserId, receiverId: chatId },
        { senderId: chatId, receiverId: currentUserId },
      ];
    }

    const messages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'name avatarUrl')
      .populate('reactions.userId', 'name avatarUrl')
      .populate('replyTo', 'text senderId type imageUrl')
      .populate('mentions', 'name email');

    const totalMessages = await Message.countDocuments(filter);

    // Mark messages as read
    if (isGroup) {
      await Message.updateMany(
        { chatId, senderId: { $ne: currentUserId }, status: { $ne: 'read' } },
        { status: 'read' }
      );
    } else {
      await Message.updateMany(
        { senderId: chatId, receiverId: currentUserId, status: { $ne: 'read' } },
        { status: 'read' }
      );
    }

    res.status(200).json({
      success: true,
      messages: messages.reverse(),
      hasMore: skip + messages.length < totalMessages,
      total: totalMessages,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send a message (text, voice, image, doc, location, contact card, reply, mentions)
// @route   POST /api/messages/:chatId
// @access  Private
const sendMessage = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const senderId = req.user._id;
    const {
      text,
      isGroup,
      type,
      replyTo,
      mentions,
      locationData,
      contactData,
    } = req.body;

    const isGroupChat = isGroup === 'true' || isGroup === true;

    // Check if recipient has blocked current user OR sender has blocked recipient
    if (!isGroupChat) {
      const recipientUser = await User.findById(chatId);
      const currentUser = await User.findById(senderId);
      if (recipientUser && recipientUser.blockedUsers?.includes(senderId)) {
        return res.status(403).json({
          success: false,
          message: 'You cannot send messages to this user.',
        });
      }
      if (currentUser && currentUser.blockedUsers?.includes(chatId)) {
        return res.status(403).json({
          success: false,
          message: 'Unblock user to send messages.',
        });
      }
    }

    let imageUrl = '';
    let fileData = null;

    if (req.file) {
      const uploadedUrl = await handleImageUpload(req.file, req);
      if (type === 'audio') {
        fileData = {
          url: uploadedUrl,
          name: req.file.originalname || 'Voice note',
          size: req.file.size,
          mimeType: req.file.mimetype,
        };
      } else if (type === 'video') {
        fileData = {
          url: uploadedUrl,
          name: req.file.originalname || 'Video',
          size: req.file.size,
          mimeType: req.file.mimetype,
        };
        imageUrl = uploadedUrl;
      } else if (type === 'document') {
        fileData = {
          url: uploadedUrl,
          name: req.file.originalname || 'Document',
          size: req.file.size,
          mimeType: req.file.mimetype,
        };
      } else {
        imageUrl = uploadedUrl;
      }
    }

    // Extract OpenGraph link preview if text contains a URL
    const linkPreview = await extractLinkPreview(text);

    // Check chat settings for disappearing messages duration
    const chatSettings = await ChatSettings.findOne({ userId: senderId, chatId });
    let expiresAt = null;
    if (chatSettings && chatSettings.disappearingDuration > 0) {
      expiresAt = new Date(Date.now() + chatSettings.disappearingDuration * 1000);
    }

    // Process mentions array if provided
    let parsedMentions = [];
    if (mentions) {
      try { parsedMentions = typeof mentions === 'string' ? JSON.parse(mentions) : mentions; } catch (e) { parsedMentions = []; }
    }

    let parsedLocation = null;
    if (locationData) {
      try { parsedLocation = typeof locationData === 'string' ? JSON.parse(locationData) : locationData; } catch (e) { parsedLocation = null; }
    }

    let parsedContact = null;
    if (contactData) {
      try { parsedContact = typeof contactData === 'string' ? JSON.parse(contactData) : contactData; } catch (e) { parsedContact = null; }
    }

    const newMessage = await Message.create({
      senderId,
      receiverId: isGroupChat ? null : chatId,
      chatId,
      isGroup: isGroupChat,
      type: type || (fileData ? (type === 'audio' ? 'audio' : 'document') : imageUrl ? 'image' : 'text'),
      text: text ? text.trim() : '',
      imageUrl,
      fileData,
      locationData: parsedLocation,
      contactData: parsedContact,
      replyTo: replyTo || null,
      mentions: parsedMentions,
      linkPreview,
      expiresAt,
      status: isGroupChat ? 'delivered' : 'sent',
    });

    const populatedMsg = await Message.findById(newMessage._id)
      .populate('senderId', 'name avatarUrl')
      .populate('replyTo', 'text senderId type imageUrl')
      .populate('mentions', 'name email');

    // Real-time socket emissions
    if (io) {
      if (isGroupChat) {
        io.to(`group:${chatId}`).emit('newMessage', populatedMsg);
      } else {
        const receiverSockets = getReceiverSocketId(chatId);
        if (receiverSockets && receiverSockets.length > 0) {
          receiverSockets.forEach((sId) => io.to(sId).emit('newMessage', populatedMsg));
        }
        // Emit to sender's other tabs
        const senderSockets = getReceiverSocketId(senderId.toString());
        senderSockets.forEach((sId) => io.to(sId).emit('newMessage', populatedMsg));
      }
    }

    res.status(201).json({
      success: true,
      message: populatedMsg,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle emoji reaction on message
// @route   POST /api/messages/:messageId/reaction
// @access  Private
const toggleReaction = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    const existingIdx = message.reactions.findIndex(
      (r) => r.userId.toString() === userId.toString()
    );

    if (existingIdx > -1) {
      if (message.reactions[existingIdx].emoji === emoji) {
        message.reactions.splice(existingIdx, 1); // Remove reaction if same
      } else {
        message.reactions[existingIdx].emoji = emoji; // Update reaction
      }
    } else {
      message.reactions.push({ userId, emoji });
    }

    await message.save();

    const populated = await Message.findById(message._id).populate('reactions.userId', 'name avatarUrl');

    if (io) {
      if (message.isGroup) {
        io.to(`group:${message.chatId}`).emit('messageReaction', {
          messageId: message._id,
          reactions: populated.reactions,
        });
      } else {
        const receiverSockets = getReceiverSocketId(message.chatId.toString());
        const senderSockets = getReceiverSocketId(userId.toString());
        const allSockets = Array.from(new Set([...receiverSockets, ...senderSockets]));
        allSockets.forEach((sId) => {
          io.to(sId).emit('messageReaction', {
            messageId: message._id,
            reactions: populated.reactions,
          });
        });
      }
    }

    res.status(200).json({
      success: true,
      reactions: populated.reactions,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Star or unstar message
// @route   POST /api/messages/:messageId/star
// @access  Private
const toggleStarMessage = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    const idx = message.starredBy.indexOf(userId);
    let isStarred = false;

    if (idx > -1) {
      message.starredBy.splice(idx, 1);
    } else {
      message.starredBy.push(userId);
      isStarred = true;
    }

    await message.save();

    res.status(200).json({
      success: true,
      isStarred,
      starredBy: message.starredBy,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Forward message to multiple target chats
// @route   POST /api/messages/:messageId/forward
// @access  Private
const forwardMessage = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { targetChatIds } = req.body; // Array of chatIds (users or groups)
    const senderId = req.user._id;

    const originalMsg = await Message.findById(messageId);
    if (!originalMsg) return res.status(404).json({ success: false, message: 'Message not found' });

    originalMsg.forwardCount = (originalMsg.forwardCount || 0) + 1;
    await originalMsg.save();

    const forwardedMessages = [];

    for (const targetId of targetChatIds) {
      const isGroup = await Group.exists({ _id: targetId });

      const newMsg = await Message.create({
        senderId,
        receiverId: isGroup ? null : targetId,
        chatId: targetId,
        isGroup: !!isGroup,
        type: originalMsg.type,
        text: originalMsg.text,
        imageUrl: originalMsg.imageUrl,
        fileData: originalMsg.fileData,
        locationData: originalMsg.locationData,
        contactData: originalMsg.contactData,
        forwarded: true,
        forwardCount: originalMsg.forwardCount,
      });

      const populated = await Message.findById(newMsg._id).populate('senderId', 'name avatarUrl');
      forwardedMessages.push(populated);

      if (io) {
        if (isGroup) {
          io.to(`group:${targetId}`).emit('newMessage', populated);
        } else {
          const recipientSockets = getReceiverSocketId(targetId);
          const senderSockets = getReceiverSocketId(senderId.toString());
          const allSockets = Array.from(new Set([...recipientSockets, ...senderSockets]));
          allSockets.forEach((sId) => io.to(sId).emit('newMessage', populated));
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Message forwarded successfully',
      forwardedMessages,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all starred messages for user
// @route   GET /api/messages/starred
// @access  Private
const getStarredMessages = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const messages = await Message.find({
      starredBy: userId,
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: -1 })
      .populate('senderId', 'name avatarUrl');

    res.status(200).json({
      success: true,
      starredMessages: messages,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Search text inside a chat or across all chats
// @route   GET /api/messages/search?q=query&chatId=optional
// @access  Private
const searchMessages = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const query = req.query.q || '';
    const chatId = req.query.chatId;

    if (!query.trim()) return res.status(200).json({ success: true, results: [] });

    const regex = new RegExp(query.trim(), 'i');
    let filter = {
      text: regex,
      deletedFor: { $ne: userId },
    };

    if (chatId) {
      filter.chatId = chatId;
    } else {
      // Cross-chat search
      const userGroups = await Group.find({ 'members.userId': userId }).select('_id');
      const groupIds = userGroups.map((g) => g._id.toString());

      filter.$or = [
        { senderId: userId },
        { receiverId: userId },
        { chatId: { $in: groupIds } },
      ];
    }

    const results = await Message.find(filter)
      .sort({ createdAt: -1 })
      .limit(30)
      .populate('senderId', 'name avatarUrl');

    res.status(200).json({
      success: true,
      results,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMessages,
  sendMessage,
  toggleReaction,
  toggleStarMessage,
  forwardMessage,
  getStarredMessages,
  searchMessages,
};
