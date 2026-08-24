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

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    const status = await Status.create({
      userId,
      type: type || (mediaUrl ? 'image' : 'text'),
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

// @desc    Get status feed (current user + contacts' active 24h statuses)
// @route   GET /api/statuses
// @access  Private
const getStatusesFeed = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Fetch saved contacts for current user
    const savedContacts = await Contact.find({ ownerId: userId });
    const savedContactIds = savedContacts.map((c) => c.contactUserId);
    const nicknameMap = new Map();
    savedContacts.forEach((c) => {
      if (c.nickname) nicknameMap.set(c.contactUserId.toString(), c.nickname);
    });

    // Fetch active statuses ONLY for current user + saved contacts
    const activeStatuses = await Status.find({
      userId: { $in: [userId, ...savedContactIds] },
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
    const contactStatuses = feed.filter((f) => f.user._id.toString() !== userId.toString());

    res.status(200).json({
      success: true,
      myStatus,
      contactStatuses,
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
  markStatusViewed,
  deleteStatus,
};
