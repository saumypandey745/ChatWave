const ChatSettings = require('../models/ChatSettings');
const { handleImageUpload } = require('../config/cloudinary');

// @desc    Get all chat settings for logged in user
// @route   GET /api/chat-settings
// @access  Private
const getAllChatSettings = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const settings = await ChatSettings.find({ userId });
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
    const { pinned, archived, muted, muteHours, wallpaperColor, disappearingDuration } = req.body;

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

    if (typeof muted === 'boolean') {
      settings.muted = muted;
      if (muted && muteHours) {
        const until = new Date();
        until.setHours(until.getHours() + parseInt(muteHours));
        settings.mutedUntil = until;
      } else {
        settings.mutedUntil = null;
      }
    }

    if (wallpaperColor !== undefined) {
      settings.wallpaper = wallpaperColor;
    }

    if (req.file) {
      const wallpaperUrl = await handleImageUpload(req.file, req);
      if (wallpaperUrl) settings.wallpaper = wallpaperUrl;
    }

    if (typeof disappearingDuration === 'number') {
      settings.disappearingDuration = disappearingDuration;
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
