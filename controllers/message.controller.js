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

    const rawMessages = await Message.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('senderId', 'name avatarUrl')
      .populate('reactions.userId', 'name avatarUrl')
      .populate('replyTo', 'text senderId type imageUrl')
      .populate('mentions', 'name email');

    // Redact media URLs for opened view-once messages
    const messages = rawMessages.map((msg) => {
      const msgObj = msg.toObject();
      if (msgObj.isViewOnce && msgObj.viewOnceState === 'opened') {
        msgObj.imageUrl = '';
        if (msgObj.fileData) msgObj.fileData.url = '';
      }
      return msgObj;
    });

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
      isViewOnce,
      imageUrl: reqImageUrl,
      isSticker,
      isGif,
    } = req.body;

    const isGroupChat = isGroup === 'true' || isGroup === true;

    // Check group permissions if sending to a group
    if (isGroupChat) {
      const group = await Group.findById(chatId);
      if (!group) return res.status(404).json({ success: false, message: 'Group not found' });
      if (group.permissions?.sendMessages === 'admins') {
        const member = group.members.find((m) => m.userId.toString() === senderId.toString());
        if (!member || member.role !== 'admin') {
          return res.status(403).json({
            success: false,
            message: 'Only admins can send messages in this group.',
          });
        }
      }
    } else {
      // Check if recipient has blocked current user OR sender has blocked recipient
      const recipientUser = await User.findById(chatId);
      const currentUser = await User.findById(senderId);
      if (
        recipientUser &&
        recipientUser.blockedUsers?.some((b) => b.toString() === senderId.toString())
      ) {
        return res.status(403).json({
          success: false,
          message: 'You cannot send messages to this user.',
        });
      }
      if (
        currentUser &&
        currentUser.blockedUsers?.some((b) => b.toString() === chatId.toString())
      ) {
        return res.status(403).json({
          success: false,
          message: 'Unblock user to send messages.',
        });
      }
    }

    let imageUrl = reqImageUrl || '';
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

    // Check chat settings or group model for disappearing messages duration
    let duration = 0;
    if (isGroupChat) {
      const group = await Group.findById(chatId);
      if (group && group.disappearingDuration > 0) {
        duration = group.disappearingDuration;
      }
    } else {
      const chatSettings = await ChatSettings.findOne({ userId: senderId, chatId });
      if (chatSettings && chatSettings.disappearingDuration > 0) {
        duration = chatSettings.disappearingDuration;
      }
    }

    let expiresAt = null;
    if (duration > 0) {
      expiresAt = new Date(Date.now() + duration * 1000);
    }

    // Process mentions array if provided
    let parsedMentions = [];
    if (mentions) {
      try { parsedMentions = typeof mentions === 'string' ? JSON.parse(mentions) : mentions; } catch (e) { parsedMentions = []; }
    }

    let parsedLocation = null;
    if (locationData) {
      try {
        parsedLocation = typeof locationData === 'string' ? JSON.parse(locationData) : locationData;
        if (parsedLocation && parsedLocation.isLive) {
          const liveDuration = Number(parsedLocation.liveDuration) || 3600;
          parsedLocation.liveDuration = liveDuration;
          parsedLocation.liveExpiresAt = new Date(Date.now() + liveDuration * 1000);
          parsedLocation.isEnded = false;
        }
      } catch (e) { parsedLocation = null; }
    }

    let parsedContact = null;
    if (contactData) {
      try { parsedContact = typeof contactData === 'string' ? JSON.parse(contactData) : contactData; } catch (e) { parsedContact = null; }
    }

    let parsedPoll = null;
    if (type === 'poll' || req.body.pollData) {
      try {
        const pData = typeof req.body.pollData === 'string' ? JSON.parse(req.body.pollData) : req.body.pollData;
        if (pData && pData.options) {
          parsedPoll = {
            question: pData.question || '',
            options: pData.options.map((opt) => ({
              text: typeof opt === 'string' ? opt : opt.text,
              votes: [],
            })),
            allowMultiple: Boolean(pData.allowMultiple),
            endedAt: null,
          };
        }
      } catch (e) {
        parsedPoll = null;
      }
    }

    const newMessage = await Message.create({
      senderId,
      receiverId: isGroupChat ? null : chatId,
      chatId,
      isGroup: isGroupChat,
      type: type || (fileData ? (type === 'audio' ? 'audio' : 'document') : imageUrl ? (isSticker ? 'sticker' : isGif ? 'gif' : 'image') : 'text'),
      text: text ? text.trim() : '',
      imageUrl,
      isSticker: isSticker === 'true' || isSticker === true || type === 'sticker',
      isGif: isGif === 'true' || isGif === true || type === 'gif',
      fileData,
      locationData: parsedLocation,
      contactData: parsedContact,
      poll: parsedPoll,
      replyTo: replyTo || null,
      mentions: parsedMentions,
      linkPreview,
      expiresAt,
      isViewOnce: isViewOnce === 'true' || isViewOnce === true,
      status: isGroupChat ? 'delivered' : 'sent',
    });

    // Revive chat settings if previously marked deleted
    try {
      if (isGroupChat && group) {
        await ChatSettings.updateMany(
          { chatId, userId: { $in: group.members.map((m) => m.userId) } },
          { deleted: false, deletedAt: null }
        );
      } else {
        await ChatSettings.updateMany(
          { chatId: { $in: [chatId, senderId.toString()] }, userId: { $in: [senderId, chatId] } },
          { deleted: false, deletedAt: null }
        );
      }
    } catch (e) {
      console.error('Error resetting chat deleted state:', e);
    }

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

// @desc    Mark a view-once media message as opened & revoke file access server-side
// @route   POST /api/messages/:messageId/view-once
// @access  Private
const handleViewOnce = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });
    if (!message.isViewOnce) return res.status(400).json({ success: false, message: 'Not a view-once message' });

    if (message.viewOnceState === 'opened') {
      return res.status(400).json({ success: false, message: 'Media already opened' });
    }

    message.viewOnceState = 'opened';
    message.viewedBy.push({ userId, viewedAt: new Date() });

    // Revoke file/image access server-side
    message.imageUrl = '';
    if (message.fileData) {
      message.fileData.url = '';
    }

    await message.save();

    // Broadcast socket event
    if (io) {
      const payload = { messageId: message._id, viewOnceState: 'opened', userId };
      if (message.isGroup) {
        io.to(`group:${message.chatId}`).emit('messageViewOnceOpened', payload);
      } else {
        const receiverSockets = getReceiverSocketId(message.chatId.toString());
        const senderSockets = getReceiverSocketId(message.senderId.toString());
        const allSockets = Array.from(new Set([...receiverSockets, ...senderSockets]));
        allSockets.forEach((sId) => io.to(sId).emit('messageViewOnceOpened', payload));
      }
    }

    res.status(200).json({
      success: true,
      message: 'View-once media opened',
      viewOnceState: 'opened',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get detailed message info (delivery & read stats per recipient)
// @route   GET /api/messages/:messageId/info
// @access  Private
const getMessageInfo = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId)
      .populate('senderId', 'name avatarUrl email')
      .populate('reactions.userId', 'name avatarUrl');

    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    if (message.senderId._id.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only message sender can view message info' });
    }

    let recipients = [];

    if (message.isGroup) {
      const group = await Group.findById(message.chatId).populate('members.userId', 'name avatarUrl email');
      if (group) {
        recipients = group.members
          .filter((m) => m.userId && m.userId._id.toString() !== userId.toString())
          .map((m) => {
            return {
              user: m.userId,
              status: message.status === 'read' ? 'read' : 'delivered',
              readAt: message.status === 'read' ? message.updatedAt : null,
              deliveredAt: message.createdAt,
            };
          });
      }
    } else {
      const receiver = await User.findById(message.receiverId || message.chatId).select('name avatarUrl email');
      if (receiver) {
        recipients.push({
          user: receiver,
          status: message.status,
          readAt: message.status === 'read' ? message.updatedAt : null,
          deliveredAt: message.createdAt,
        });
      }
    }

    res.status(200).json({
      success: true,
      messageInfo: {
        message,
        recipients,
        sentAt: message.createdAt,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Vote on a poll option
// @route   POST /api/messages/:messageId/poll-vote
// @access  Private
const votePoll = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const { optionIndex, optionIndexes } = req.body;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message || message.type !== 'poll' || !message.poll) {
      return res.status(404).json({ success: false, message: 'Poll message not found' });
    }

    if (message.poll.endedAt) {
      return res.status(400).json({ success: false, message: 'This poll has ended' });
    }

    const selectedIndexes = Array.isArray(optionIndexes)
      ? optionIndexes
      : optionIndex !== undefined
      ? [optionIndex]
      : [];

    if (!message.poll.allowMultiple) {
      // Clear votes from all options first
      message.poll.options.forEach((opt) => {
        opt.votes = opt.votes.filter((vId) => vId.toString() !== userId.toString());
      });

      // Add vote to single selected option if valid index
      if (selectedIndexes.length > 0) {
        const idx = selectedIndexes[0];
        if (message.poll.options[idx]) {
          message.poll.options[idx].votes.push(userId);
        }
      }
    } else {
      // Toggle vote for selected indexes
      selectedIndexes.forEach((idx) => {
        const opt = message.poll.options[idx];
        if (opt) {
          const existingIdx = opt.votes.findIndex((vId) => vId.toString() === userId.toString());
          if (existingIdx !== -1) {
            opt.votes.splice(existingIdx, 1);
          } else {
            opt.votes.push(userId);
          }
        }
      });
    }

    await message.save();

    const updatedMessage = await Message.findById(messageId)
      .populate('senderId', 'name avatarUrl')
      .populate('poll.options.votes', 'name avatarUrl');

    if (io) {
      if (message.isGroup) {
        io.to(`group:${message.chatId}`).emit('pollVoted', { messageId, poll: updatedMessage.poll });
      } else {
        io.to(`user:${message.senderId}`).emit('pollVoted', { messageId, poll: updatedMessage.poll });
        io.to(`user:${message.receiverId}`).emit('pollVoted', { messageId, poll: updatedMessage.poll });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Vote recorded',
      poll: updatedMessage.poll,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    End poll
// @route   POST /api/messages/:messageId/poll-end
// @access  Private
const endPoll = async (req, res, next) => {
  try {
    const { messageId } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(messageId);
    if (!message || message.type !== 'poll' || !message.poll) {
      return res.status(404).json({ success: false, message: 'Poll message not found' });
    }

    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only poll creator can end poll' });
    }

    message.poll.endedAt = new Date();
    await message.save();

    const updatedMessage = await Message.findById(messageId)
      .populate('senderId', 'name avatarUrl')
      .populate('poll.options.votes', 'name avatarUrl');

    if (io) {
      if (message.isGroup) {
        io.to(`group:${message.chatId}`).emit('pollEnded', { messageId, endedAt: message.poll.endedAt });
      } else {
        io.to(`user:${message.senderId}`).emit('pollEnded', { messageId, endedAt: message.poll.endedAt });
        io.to(`user:${message.receiverId}`).emit('pollEnded', { messageId, endedAt: message.poll.endedAt });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Poll ended',
      poll: updatedMessage.poll,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Clear chat history for current user (keeps chat in list)
// @route   POST /api/messages/chat/:chatId/clear
// @access  Private
const clearChat = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const isGroup = await Group.exists({ _id: chatId });

    if (isGroup) {
      await Message.updateMany(
        { chatId: chatId, deletedFor: { $ne: userId } },
        { $addToSet: { deletedFor: userId } }
      );
    } else {
      await Message.updateMany(
        {
          $or: [
            { senderId: userId, receiverId: chatId },
            { senderId: chatId, receiverId: userId },
          ],
          deletedFor: { $ne: userId },
        },
        { $addToSet: { deletedFor: userId } }
      );
    }

    // 3. Ensure ChatSettings exists with deleted: false so chat stays active in list
    await ChatSettings.findOneAndUpdate(
      { userId, chatId },
      { deleted: false },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Chat cleared successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete chat for current user (clears history + hides chat from list)
// @route   DELETE /api/messages/chat/:chatId
// @access  Private
const deleteChat = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    const isGroup = await Group.exists({ _id: chatId });

    // 1. Add userId to deletedFor on all existing messages
    if (isGroup) {
      await Message.updateMany(
        { chatId: chatId, deletedFor: { $ne: userId } },
        { $addToSet: { deletedFor: userId } }
      );
    } else {
      await Message.updateMany(
        {
          $or: [
            { senderId: userId, receiverId: chatId },
            { senderId: chatId, receiverId: userId },
          ],
          deletedFor: { $ne: userId },
        },
        { $addToSet: { deletedFor: userId } }
      );
    }

    // 2. Update ChatSettings to deleted = true
    await ChatSettings.findOneAndUpdate(
      { userId, chatId },
      { deleted: true, deletedAt: new Date() },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Chat deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Stop live location sharing early
// @route   POST /api/messages/:id/stop-live-location
// @access  Private
const stopLiveLocation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const message = await Message.findById(id);
    if (!message) return res.status(404).json({ success: false, message: 'Message not found' });

    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Not authorized to stop live location' });
    }

    if (message.locationData) {
      message.locationData.isEnded = true;
      await message.save();
    }

    res.status(200).json({
      success: true,
      message: 'Live location sharing stopped',
      messageData: message,
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
  handleViewOnce,
  getMessageInfo,
  votePoll,
  endPoll,
  clearChat,
  deleteChat,
  stopLiveLocation,
};

