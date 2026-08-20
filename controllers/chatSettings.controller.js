const ChatSettings = require('../models/ChatSettings');
const Group = require('../models/Group');
const Message = require('../models/Message');
const User = require('../models/User');
const { handleImageUpload } = require('../config/cloudinary');
const { io, getReceiverSocketId } = require('../socket/socket');

// Helper to check & clean expired mute setting
const cleanMuteSetting = async (settings) => {
  if (settings.muted && settings.mutedUntil && new Date(settings.mutedUntil) <= new Date()) {
    settings.muted = false;
    settings.mutedUntil = null;
    settings.muteOption = 'off';
    await settings.save();
  }
  return settings;
};

// Helper to create system message for chat settings (e.g. disappearing messages update)
const logDisappearingSystemMessage = async (chatId, isGroup, text, senderId) => {
  const message = await Message.create({
    senderId,
    receiverId: isGroup ? null : chatId,
    chatId: chatId.toString(),
    isGroup,
    type: 'system',
    text,
  });

  const populated = await Message.findById(message._id).populate('senderId', 'name avatarUrl');

  if (io) {
    if (isGroup) {
      io.to(`group:${chatId}`).emit('newMessage', populated);
    } else {
      const receiverSockets = getReceiverSocketId(chatId.toString());
      const senderSockets = getReceiverSocketId(senderId.toString());
      const allSockets = Array.from(new Set([...receiverSockets, ...senderSockets]));
      allSockets.forEach((sId) => io.to(sId).emit('newMessage', populated));
    }
  }
  return message;
};

// @desc    Get all chat settings for logged in user
// @route   GET /api/chat-settings
// @access  Private
const getAllChatSettings = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const rawSettings = await ChatSettings.find({ userId });

    const settings = await Promise.all(rawSettings.map((s) => cleanMuteSetting(s)));
    res.status(200).json({ success: true, settings });
  } catch (error) {
    next(error);
  }
};

// @desc    Update per-chat settings (pin, archive, mute, wallpaper, disappearing timer)
// @route   PUT /api/chat-settings/:chatId
// @access  Private
const updateChatSettings = async (req, res, next) => {
  try {
    const { chatId } = req.params;
    const userId = req.user._id;

    // Support JSON or Form-Data inputs
    const pinned = req.body.pinned !== undefined ? (req.body.pinned === 'true' || req.body.pinned === true) : undefined;
    const archived = req.body.archived !== undefined ? (req.body.archived === 'true' || req.body.archived === true) : undefined;
    const muted = req.body.muted !== undefined ? (req.body.muted === 'true' || req.body.muted === true) : undefined;
    const muteHours = req.body.muteHours !== undefined ? parseInt(req.body.muteHours) : undefined;
    const wallpaperColor = req.body.wallpaperColor;
    const disappearingDuration = req.body.disappearingDuration !== undefined ? parseInt(req.body.disappearingDuration) : undefined;

    let settings = await ChatSettings.findOne({ userId, chatId });
    if (!settings) {
      settings = new ChatSettings({ userId, chatId });
    }

    // Pin check: limit max 3 pinned chats
    if (typeof pinned === 'boolean') {
      if (pinned && !settings.pinned) {
        const pinnedCount = await ChatSettings.countDocuments({ userId, pinned: true });
        if (pinnedCount >= 3) {
          return res.status(400).json({
            success: false,
            message: 'You can pin a maximum of 3 chats',
          });
        }
      }
      settings.pinned = pinned;
    }

    if (typeof archived === 'boolean') {
      settings.archived = archived;
    }

    // Mute Notifications logic
    if (typeof muted === 'boolean') {
      if (muted) {
        settings.muted = true;
        if (muteHours && muteHours > 0) {
          if (muteHours === 8) {
            settings.muteOption = '8h';
          } else if (muteHours === 168) {
            settings.muteOption = '1w';
          } else {
            settings.muteOption = 'always';
          }
          if (muteHours >= 87600) {
            settings.muteOption = 'always';
            settings.mutedUntil = null;
          } else {
            const until = new Date();
            until.setHours(until.getHours() + muteHours);
            settings.mutedUntil = until;
          }
        } else {
          settings.muteOption = 'always';
          settings.mutedUntil = null;
        }
      } else {
        settings.muted = false;
        settings.mutedUntil = null;
        settings.muteOption = 'off';
      }
    }

    if (wallpaperColor !== undefined) {
      settings.wallpaper = wallpaperColor;
    }

    if (req.file) {
      const wallpaperUrl = await handleImageUpload(req.file, req);
      if (wallpaperUrl) settings.wallpaper = wallpaperUrl;
    }

    // Disappearing Messages logic
    if (typeof disappearingDuration === 'number') {
      const oldDuration = settings.disappearingDuration || 0;
      settings.disappearingDuration = disappearingDuration;

      const isGroup = await Group.exists({ _id: chatId });

      if (isGroup) {
        await Group.findByIdAndUpdate(chatId, { disappearingDuration });
      } else {
        // For 1-on-1 chat, apply to recipient's ChatSettings as well
        await ChatSettings.findOneAndUpdate(
          { userId: chatId, chatId: userId.toString() },
          { disappearingDuration },
          { upsert: true, new: true }
        );
      }

      // Log system message if duration changed
      if (oldDuration !== disappearingDuration) {
        let label = 'Off';
        if (disappearingDuration === 86400) label = '24 hours';
        else if (disappearingDuration === 604800) label = '7 days';
        else if (disappearingDuration === 7776000) label = '90 days';

        const text = disappearingDuration > 0
          ? `${req.user.name} turned on disappearing messages: ${label}`
          : `${req.user.name} turned off disappearing messages`;

        await logDisappearingSystemMessage(chatId, !!isGroup, text, userId);
      }
    }

    await settings.save();

    res.status(200).json({
      success: true,
      message: 'Chat settings updated',
      settings,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAllChatSettings,
  updateChatSettings,
};
