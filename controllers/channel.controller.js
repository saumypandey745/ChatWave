const Channel = require('../models/Channel');
const ChannelPost = require('../models/ChannelPost');
const User = require('../models/User');
const Report = require('../models/Report');
const { io } = require('../socket/socket');

// Helper to check if user is channel owner or admin
const isChannelAdmin = (channel, userId) => {
  const uStr = userId.toString();
  if (channel.ownerId.toString() === uStr) return true;
  if (channel.admins && channel.admins.some((a) => a.toString() === uStr)) return true;
  return false;
};

// @desc    Get directory of all public channels with search, category filter, and sorting
// @route   GET /api/channels
// @access  Private
const getChannels = async (req, res, next) => {
  try {
    const userId = req.user._id;
    const { search, category, sort } = req.query;

    // Seed default verified channel if database is empty
    const count = await Channel.countDocuments();
    if (count === 0) {
      await Channel.create({
        name: 'ChatWave Official Updates',
        handle: 'chatwave_official',
        description: 'Official announcements, new features, and security updates from the ChatWave team.',
        verified: true,
        category: 'Tech',
        ownerId: userId,
        admins: [userId],
        subscribers: [userId],
        subscriberCount: 1240,
      });
    }

    const query = {};
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), 'i');
      query.$or = [{ name: searchRegex }, { handle: searchRegex }, { description: searchRegex }];
    }
    if (category && category !== 'All' && category.trim()) {
      query.category = category.trim();
    }

    let sortOptions = { subscriberCount: -1 };
    if (sort === 'newest') sortOptions = { createdAt: -1 };
    if (sort === 'alphabetical') sortOptions = { name: 1 };

    const channels = await Channel.find(query)
      .populate('ownerId', 'name avatarUrl chatwaveId')
      .populate('admins', 'name avatarUrl chatwaveId')
      .populate('pinnedPostId')
      .sort(sortOptions);

    const currentUser = await User.findById(userId).select('mutedChannels');
    const mutedSet = new Set((currentUser?.mutedChannels || []).map((id) => id.toString()));

    const formattedChannels = channels.map((ch) => {
      const uStr = userId.toString();
      const isSubscribed = ch.subscribers.some((sId) => sId.toString() === uStr);
      const isOwner = ch.ownerId?._id?.toString() === uStr || ch.ownerId?.toString() === uStr;
      const isAdmin = isOwner || ch.admins?.some((aId) => (aId._id || aId).toString() === uStr);
      const isMuted = mutedSet.has(ch._id.toString());

      return {
        ...ch.toObject(),
        isSubscribed,
        isOwner,
        isAdmin,
        isMuted,
      };
    });

    res.status(200).json({
      success: true,
      channels: formattedChannels,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new Broadcast Channel
// @route   POST /api/channels
// @access  Private
const createChannel = async (req, res, next) => {
  try {
    const { name, handle, description, avatarUrl, category } = req.body;
    const userId = req.user._id;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Channel name is required' });
    }

    let sanitizedHandle = handle
      ? handle.toLowerCase().replace(/[^a-z0-9_]/g, '')
      : name.toLowerCase().replace(/[^a-z0-9_]/g, '');

    if (!sanitizedHandle) {
      sanitizedHandle = `channel_${Date.now()}`;
    }

    const existingHandle = await Channel.findOne({ handle: sanitizedHandle });
    if (existingHandle) {
      if (handle) {
        return res.status(400).json({ success: false, message: 'Channel handle already taken' });
      }
      sanitizedHandle = `${sanitizedHandle}_${Math.floor(1000 + Math.random() * 9000)}`;
    }

    const channel = await Channel.create({
      name: name.trim(),
      handle: sanitizedHandle,
      description: description ? description.trim() : '',
      avatarUrl: avatarUrl || undefined,
      category: category || 'General',
      ownerId: userId,
      admins: [userId],
      subscribers: [userId],
      subscriberCount: 1,
    });

    const formattedChannel = {
      ...channel.toObject(),
      isSubscribed: true,
      isOwner: true,
      isAdmin: true,
      isMuted: false,
    };

    res.status(201).json({
      success: true,
      message: 'Channel created successfully',
      channel: formattedChannel,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Channel Details (Owner/Admin)
// @route   PUT /api/channels/:id
// @access  Private
const updateChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, handle, description, avatarUrl, category } = req.body;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (!isChannelAdmin(channel, userId)) {
      return res.status(403).json({ success: false, message: 'Only Channel Owner or Admins can edit details' });
    }

    if (name && name.trim()) channel.name = name.trim();
    if (description !== undefined) channel.description = description.trim();
    if (avatarUrl !== undefined) channel.avatarUrl = avatarUrl;
    if (category !== undefined) channel.category = category;

    if (handle && handle.trim().toLowerCase() !== channel.handle) {
      const sanitized = handle.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
      const existing = await Channel.findOne({ handle: sanitized });
      if (existing && existing._id.toString() !== id) {
        return res.status(400).json({ success: false, message: 'Handle already taken' });
      }
      channel.handle = sanitized;
    }

    await channel.save();

    res.status(200).json({
      success: true,
      message: 'Channel updated successfully',
      channel,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Promote or Demote Channel Admin (Owner Only)
// @route   POST /api/channels/:id/admins/:action
// @access  Private (Owner Only)
const promoteDemoteChannelAdmin = async (req, res, next) => {
  try {
    const { id, action } = req.params; // 'promote' | 'demote'
    const { targetUserId } = req.body;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (channel.ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only Channel Owner can manage admins' });
    }

    if (action === 'demote' && channel.ownerId.toString() === targetUserId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot demote channel owner' });
    }

    if (action === 'promote') {
      if (!channel.admins.some((a) => a.toString() === targetUserId.toString())) {
        channel.admins.push(targetUserId);
      }
    } else {
      channel.admins = channel.admins.filter((a) => a.toString() !== targetUserId.toString());
    }

    await channel.save();

    res.status(200).json({
      success: true,
      message: `Admin ${action}d successfully`,
      admins: channel.admins,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Follow / Unfollow Channel
// @route   POST /api/channels/:id/follow
// @access  Private
const toggleFollowChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    const isSubscribed = channel.subscribers.some((sId) => sId.toString() === userId.toString());

    if (isSubscribed) {
      channel.subscribers = channel.subscribers.filter((sId) => sId.toString() !== userId.toString());
      channel.subscriberCount = Math.max(0, channel.subscriberCount - 1);
    } else {
      channel.subscribers.push(userId);
      channel.subscriberCount += 1;
    }

    await channel.save();

    res.status(200).json({
      success: true,
      isSubscribed: !isSubscribed,
      subscriberCount: channel.subscriberCount,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mute / Unmute Channel Notifications
// @route   POST /api/channels/:id/mute
// @access  Private
const toggleMuteChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const user = await User.findById(userId);
    const isMuted = user.mutedChannels.some((cId) => cId.toString() === id);

    if (isMuted) {
      user.mutedChannels = user.mutedChannels.filter((cId) => cId.toString() !== id);
    } else {
      user.mutedChannels.push(id);
    }

    await user.save();

    res.status(200).json({
      success: true,
      isMuted: !isMuted,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get Channel Posts feed & track unique views
// @route   GET /api/channels/:id/posts
// @access  Private
const getChannelPosts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const posts = await ChannelPost.find({ channelId: id })
      .populate('senderId', 'name avatarUrl')
      .sort({ createdAt: 1 });

    // Track unique views for fetched posts
    for (const post of posts) {
      if (!post.uniqueViewers.some((vId) => vId.toString() === userId.toString())) {
        post.uniqueViewers.push(userId);
        await post.save();
      }
    }

    res.status(200).json({
      success: true,
      posts,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get aggregated Channel Updates feed across all followed channels
// @route   GET /api/channels/updates-feed
// @access  Private
const getChannelUpdatesFeed = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Find all channels user follows
    const followedChannels = await Channel.find({ subscribers: userId }).select('_id');
    const channelIds = followedChannels.map((c) => c._id);

    const posts = await ChannelPost.find({ channelId: { $in: channelIds } })
      .populate('channelId', 'name avatarUrl handle verified category')
      .populate('senderId', 'name avatarUrl')
      .sort({ createdAt: -1 })
      .limit(50);

    res.status(200).json({
      success: true,
      posts,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Post update to Channel (Text, Image, Video, Document, Poll)
// @route   POST /api/channels/:id/posts
// @access  Private (Owner / Admin Only)
const createChannelPost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content, mediaUrl, mediaType, fileName, fileSize, poll } = req.body;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (!isChannelAdmin(channel, userId)) {
      return res.status(403).json({ success: false, message: 'Only Channel Owner or Admins can post updates' });
    }

    const post = await ChannelPost.create({
      channelId: channel._id,
      senderId: userId,
      content: content ? content.trim() : '',
      mediaUrl: mediaUrl || '',
      mediaType: mediaType || 'none',
      fileName: fileName || '',
      fileSize: fileSize || '',
      poll: poll || undefined,
      uniqueViewers: [userId],
    });

    const populated = await ChannelPost.findById(post._id).populate('senderId', 'name avatarUrl');

    // Real-time socket emission to subscribers
    channel.subscribers.forEach((subId) => {
      io.to(`user:${subId.toString()}`).emit('newChannelPost', { channelId: channel._id, post: populated });
    });

    res.status(201).json({
      success: true,
      post: populated,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Edit Channel Post
// @route   PUT /api/channels/:id/posts/:postId
// @access  Private (Owner / Admin / Post Author)
const editChannelPost = async (req, res, next) => {
  try {
    const { id, postId } = req.params;
    const { content, poll } = req.body;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Channel post not found' });
    }

    if (!isChannelAdmin(channel, userId) && post.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only admins or post author can edit this post' });
    }

    if (content !== undefined) post.content = content.trim();
    if (poll) post.poll = poll;
    post.editedAt = new Date();

    await post.save();

    const populated = await ChannelPost.findById(post._id).populate('senderId', 'name avatarUrl');

    res.status(200).json({
      success: true,
      message: 'Post updated successfully',
      post: populated,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete Channel Post
// @route   DELETE /api/channels/:id/posts/:postId
// @access  Private (Owner / Admin / Post Author)
const deleteChannelPost = async (req, res, next) => {
  try {
    const { id, postId } = req.params;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Channel post not found' });
    }

    if (!isChannelAdmin(channel, userId) && post.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only admins or post author can delete this post' });
    }

    // Unpin if pinned
    if (channel.pinnedPostId && channel.pinnedPostId.toString() === postId) {
      channel.pinnedPostId = null;
      await channel.save();
    }

    await ChannelPost.findByIdAndDelete(postId);

    res.status(200).json({
      success: true,
      message: 'Post deleted successfully',
      postId,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Pin / Unpin Channel Post
// @route   POST /api/channels/:id/posts/:postId/pin
// @access  Private (Owner / Admin)
const pinUnpinChannelPost = async (req, res, next) => {
  try {
    const { id, postId } = req.params;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (!isChannelAdmin(channel, userId)) {
      return res.status(403).json({ success: false, message: 'Only Channel Owner or Admins can pin posts' });
    }

    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Channel post not found' });
    }

    const isAlreadyPinned = channel.pinnedPostId && channel.pinnedPostId.toString() === postId;

    if (isAlreadyPinned) {
      channel.pinnedPostId = null;
      post.isPinned = false;
    } else {
      // Unpin previous pinned post if any
      if (channel.pinnedPostId) {
        await ChannelPost.findByIdAndUpdate(channel.pinnedPostId, { isPinned: false });
      }
      channel.pinnedPostId = post._id;
      post.isPinned = true;
    }

    await channel.save();
    await post.save();

    res.status(200).json({
      success: true,
      isPinned: !isAlreadyPinned,
      pinnedPostId: channel.pinnedPostId,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Vote in Channel Poll Post
// @route   POST /api/channels/:id/posts/:postId/poll-vote
// @access  Private
const voteChannelPoll = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { optionId } = req.body;
    const userId = req.user._id;

    const post = await ChannelPost.findById(postId);
    if (!post || !post.poll || !post.poll.options) {
      return res.status(404).json({ success: false, message: 'Poll not found' });
    }

    // Toggle vote for option
    post.poll.options.forEach((opt) => {
      const idx = opt.votes.findIndex((v) => v.toString() === userId.toString());
      if (opt.id === optionId) {
        if (idx !== -1) {
          opt.votes.splice(idx, 1);
        } else {
          opt.votes.push(userId);
        }
      }
    });

    await post.save();

    res.status(200).json({
      success: true,
      poll: post.poll,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    React with emoji to Channel Post
// @route   POST /api/channels/:id/posts/:postId/react
// @access  Private
const reactToChannelPost = async (req, res, next) => {
  try {
    const { postId } = req.params;
    const { emoji } = req.body;
    const userId = req.user._id;

    const post = await ChannelPost.findById(postId);
    if (!post) {
      return res.status(404).json({ success: false, message: 'Channel post not found' });
    }

    const existingIdx = post.reactions.findIndex((r) => r.userId.toString() === userId.toString());

    if (existingIdx !== -1) {
      if (post.reactions[existingIdx].emoji === emoji) {
        post.reactions.splice(existingIdx, 1);
      } else {
        post.reactions[existingIdx].emoji = emoji;
      }
    } else {
      post.reactions.push({ userId, emoji });
    }

    await post.save();

    res.status(200).json({
      success: true,
      reactions: post.reactions,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Report Channel
// @route   POST /api/channels/:id/report
// @access  Private
const reportChannel = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const reporterId = req.user._id;

    const report = await Report.create({
      reporterId,
      targetId: id,
      targetType: 'channel',
      reason: reason || 'Reported channel for inappropriate content',
    });

    res.status(201).json({
      success: true,
      message: 'Channel report submitted successfully',
      report,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getChannels,
  createChannel,
  updateChannel,
  promoteDemoteChannelAdmin,
  toggleFollowChannel,
  toggleMuteChannel,
  getChannelPosts,
  getChannelUpdatesFeed,
  createChannelPost,
  editChannelPost,
  deleteChannelPost,
  pinUnpinChannelPost,
  voteChannelPoll,
  reactToChannelPost,
  reportChannel,
};
