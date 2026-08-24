const Status = require('../models/Status');
const User = require('../models/User');
const Message = require('../models/Message');
const Contact = require('../models/Contact');
const { handleImageUpload } = require('../config/cloudinary');
const { io } = require('../socket/socket');

// @desc    Post a 24-hour status update
// @route   POST /api/statuses
// @access  Private
const postStatus = async (req, res, next) => {
  try {
    const { type, content, backgroundColor, font } = req.body;
    const userId = req.user._id;

    let mediaUrl = '';
    if (req.file) {
      mediaUrl = await handleImageUpload(req.file, req);
    }

    if (type !== 'text' && !mediaUrl) {
      return res.status(400).json({ success: false, message: 'Media file is required for photo/video status' });
    }

    let finalType = 'text';
    if (mediaUrl) {
      finalType = req.file?.mimetype?.startsWith('video/') ? 'video' : 'image';
    } else if (type && ['text', 'image', 'video'].includes(type)) {
      finalType = type;
    }

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    const status = await Status.create({
      userId,
      type: finalType,
      content: content ? content.trim() : '',
      mediaUrl,
      backgroundColor: backgroundColor || '#6366f1',
      font: font || 'sans',
      expiresAt,
    });

    const populatedStatus = await Status.findById(status._id).populate(
      'userId',
      'name avatarUrl'
    );

    if (io) {
      io.emit('statusPosted', populatedStatus);
    }

    res.status(201).json({
      success: true,
      message: 'Status posted successfully',
      status: populatedStatus,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get status feed (current user + permitted contacts' active 24h statuses)
// @route   GET /api/statuses
// @access  Private
const getStatusesFeed = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Fetch current user with populated mutedStatusUsers
    const currentUser = await User.findById(userId);
    const mutedUserIds = (currentUser.mutedStatusUsers || []).map((id) => id.toString());

    // Fetch saved contacts for current user
    const savedContacts = await Contact.find({ ownerId: userId });
    const savedContactIds = savedContacts.map((c) => c.contactUserId);
    const nicknameMap = new Map();
    savedContacts.forEach((c) => {
      if (c.nickname) nicknameMap.set(c.contactUserId.toString(), c.nickname);
    });

    // Determine which candidate contact owners allow the current user (viewer) to see their status
    const permittedContactOwnerIds = [userId];

    // Fetch User models for all saved contact owners to evaluate their statusPrivacy settings
    const contactUsers = await User.find({ _id: { $in: savedContactIds } });

    for (const owner of contactUsers) {
      const privacyMode = owner.statusPrivacy?.mode || 'contacts';
      const exceptions = (owner.statusPrivacy?.exceptions || []).map((id) => id.toString());

      if (privacyMode === 'contacts') {
        // Default: all saved contacts can view
        permittedContactOwnerIds.push(owner._id);
      } else if (privacyMode === 'contacts_except') {
        // Exclude specific contacts in exceptions list
        if (!exceptions.includes(userId.toString())) {
          permittedContactOwnerIds.push(owner._id);
        }
      } else if (privacyMode === 'only_share_with') {
        // Only allow contacts in exceptions list
        if (exceptions.includes(userId.toString())) {
          permittedContactOwnerIds.push(owner._id);
        }
      }
    }

    // Fetch active statuses ONLY for current user + permitted owners
    const activeStatuses = await Status.find({
      userId: { $in: permittedContactOwnerIds },
      expiresAt: { $gt: new Date() },
    })
      .sort({ createdAt: 1 })
      .populate('userId', 'name avatarUrl')
      .populate('viewedBy.userId', 'name avatarUrl');

    // Group statuses by user
    const userStatusMap = new Map();

    activeStatuses.forEach((status) => {
      if (!status.userId) return;
      const ownerId = status.userId._id.toString();

      const userObj = status.userId.toJSON ? status.userId.toJSON() : status.userId;
      if (nicknameMap.has(ownerId)) {
        userObj.name = nicknameMap.get(ownerId);
      }

      if (!userStatusMap.has(ownerId)) {
        userStatusMap.set(ownerId, {
          user: userObj,
          statuses: [],
          allViewed: true,
          isMuted: mutedUserIds.includes(ownerId),
          lastUpdated: status.createdAt,
        });
      }

      const userData = userStatusMap.get(ownerId);
      const isViewedByMe = status.viewedBy.some(
        (v) => v.userId?._id?.toString() === userId.toString() || v.userId?.toString() === userId.toString()
      );

      if (!isViewedByMe && ownerId !== userId.toString()) {
        userData.allViewed = false;
      }

      userData.statuses.push({
        _id: status._id,
        type: status.type,
        content: status.content,
        mediaUrl: status.mediaUrl,
        backgroundColor: status.backgroundColor,
        font: status.font,
        createdAt: status.createdAt,
        expiresAt: status.expiresAt,
        viewedBy: status.viewedBy,
        isViewedByMe,
      });

      userData.lastUpdated = status.createdAt;
    });

    const feed = Array.from(userStatusMap.values());

    const myStatus = feed.find((f) => f.user._id.toString() === userId.toString()) || null;
    const allContactStatuses = feed.filter((f) => f.user._id.toString() !== userId.toString());

    // Separate normal contact updates vs muted status updates
    const contactStatuses = allContactStatuses.filter((f) => !f.isMuted);
    const mutedStatuses = allContactStatuses.filter((f) => f.isMuted);

    res.status(200).json({
      success: true,
      myStatus,
      contactStatuses,
      mutedStatuses,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get current user's status privacy settings & muted status users
// @route   GET /api/statuses/privacy
// @access  Private
const getStatusPrivacy = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('statusPrivacy.exceptions', 'name avatarUrl chatwaveId email')
      .populate('mutedStatusUsers', 'name avatarUrl chatwaveId email');

    res.status(200).json({
      success: true,
      statusPrivacy: user.statusPrivacy || { mode: 'contacts', exceptions: [] },
      mutedStatusUsers: user.mutedStatusUsers || [],
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update status privacy settings ('contacts' | 'contacts_except' | 'only_share_with')
// @route   POST /api/statuses/privacy
// @access  Private
const updateStatusPrivacy = async (req, res, next) => {
  try {
    const { mode, exceptions = [] } = req.body;
    const userId = req.user._id;

    if (!['contacts', 'contacts_except', 'only_share_with'].includes(mode)) {
      return res.status(400).json({ success: false, message: 'Invalid status privacy mode' });
    }

    // Clean and validate exception ObjectIds
    const cleanExceptions = (Array.isArray(exceptions) ? exceptions : [])
      .map((item) => (typeof item === 'object' && item !== null ? item._id || item.id || item : item))
      .filter((id) => id && mongoose.Types.ObjectId.isValid(id))
      .map((id) => new mongoose.Types.ObjectId(id));

    const user = await User.findByIdAndUpdate(
      userId,
      {
        statusPrivacy: {
          mode,
          exceptions: cleanExceptions,
        },
      },
      { new: true }
    )
      .populate('statusPrivacy.exceptions', 'name avatarUrl chatwaveId email')
      .populate('mutedStatusUsers', 'name avatarUrl chatwaveId email');

    res.status(200).json({
      success: true,
      message: 'Status privacy updated successfully',
      statusPrivacy: user.statusPrivacy,
      mutedStatusUsers: user.mutedStatusUsers,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mute or Unmute a contact's status updates
// @route   POST /api/statuses/mute-user
// @access  Private
const toggleMuteStatusUser = async (req, res, next) => {
  try {
    const { targetUserId } = req.body;
    const userId = req.user._id;

    if (!targetUserId) {
      return res.status(400).json({ success: false, message: 'Target user ID is required' });
    }

    const user = await User.findById(userId);
    const isMuted = user.mutedStatusUsers.some((id) => id.toString() === targetUserId.toString());

    if (isMuted) {
      user.mutedStatusUsers = user.mutedStatusUsers.filter((id) => id.toString() !== targetUserId.toString());
    } else {
      user.mutedStatusUsers.push(targetUserId);
    }

    await user.save();

    const updatedUser = await User.findById(userId).populate(
      'mutedStatusUsers',
      'name avatarUrl chatwaveId email'
    );

    res.status(200).json({
      success: true,
      message: isMuted ? 'Contact status unmuted' : 'Contact status muted',
      isMuted: !isMuted,
      mutedStatusUsers: updatedUser.mutedStatusUsers,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark a status as viewed
// @route   POST /api/statuses/:statusId/view
// @access  Private
const markStatusViewed = async (req, res, next) => {
  try {
    const { statusId } = req.params;
    const userId = req.user._id;

    const status = await Status.findById(statusId);
    if (!status) return res.status(404).json({ success: false, message: 'Status not found' });

    const alreadyViewed = status.viewedBy.some((v) => v.userId.toString() === userId.toString());
    if (!alreadyViewed && status.userId.toString() !== userId.toString()) {
      status.viewedBy.push({ userId, viewedAt: new Date() });
      await status.save();

      if (io) {
        io.to(`user:${status.userId}`).emit('statusViewed', {
          statusId,
          viewer: { _id: userId, name: req.user.name, avatarUrl: req.user.avatarUrl },
        });
      }
    }

    res.status(200).json({ success: true, message: 'Status marked as viewed' });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a status
// @route   DELETE /api/statuses/:statusId
// @access  Private
const deleteStatus = async (req, res, next) => {
  try {
    const { statusId } = req.params;
    const userId = req.user._id;

    const status = await Status.findById(statusId);
    if (!status) return res.status(404).json({ success: false, message: 'Status not found' });

    if (status.userId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    await Status.deleteOne({ _id: statusId });

    res.status(200).json({ success: true, message: 'Status deleted' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  postStatus,
  getStatusesFeed,
  getStatusPrivacy,
  updateStatusPrivacy,
  toggleMuteStatusUser,
  markStatusViewed,
  deleteStatus,
};
