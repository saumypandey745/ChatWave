const Channel = require('../models/Channel');
const ChannelPost = require('../models/ChannelPost');

// @desc    Get directory of all public channels & user's follow state
// @route   GET /api/channels
// @access  Private
const getChannels = async (req, res, next) => {
  try {
    const userId = req.user._id;

    // Seed default verified channel if database is empty
    const count = await Channel.countDocuments();
    if (count === 0) {
      await Channel.create({
        name: 'ChatWave Official Updates',
        handle: 'chatwave_official',
        description: 'Official announcements, new features, and security updates from the ChatWave team.',
        verified: true,
        ownerId: userId,
        subscribers: [userId],
        subscriberCount: 1240,
      });
    }

    const channels = await Channel.find().sort({ subscriberCount: -1 });

    const formattedChannels = channels.map((ch) => {
      const isSubscribed = ch.subscribers.some((sId) => sId.toString() === userId.toString());
      return {
        ...ch.toObject(),
        isSubscribed,
        isOwner: ch.ownerId.toString() === userId.toString(),
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
    const { name, handle, description, avatarUrl } = req.body;
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
      ownerId: userId,
      subscribers: [userId],
      subscriberCount: 1,
    });

    const formattedChannel = {
      ...channel.toObject(),
      isSubscribed: true,
      isOwner: true,
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

// @desc    Get posts feed for channel
// @route   GET /api/channels/:id/posts
// @access  Private
const getChannelPosts = async (req, res, next) => {
  try {
    const { id } = req.params;
    const posts = await ChannelPost.find({ channelId: id })
      .populate('senderId', 'name avatarUrl')
      .sort({ createdAt: 1 });

    res.status(200).json({
      success: true,
      posts,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Post update to Channel (Owner / Admin Only)
// @route   POST /api/channels/:id/posts
// @access  Private
const createChannelPost = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content, mediaUrl, mediaType } = req.body;
    const userId = req.user._id;

    const channel = await Channel.findById(id);
    if (!channel) {
      return res.status(404).json({ success: false, message: 'Channel not found' });
    }

    if (channel.ownerId.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'Only channel owner can post updates' });
    }

    const post = await ChannelPost.create({
      channelId: channel._id,
      senderId: userId,
      content: content ? content.trim() : '',
      mediaUrl: mediaUrl || '',
      mediaType: mediaType || 'none',
    });

    const populated = await ChannelPost.findById(post._id).populate('senderId', 'name avatarUrl');

    res.status(201).json({
      success: true,
      post: populated,
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

    // Existing reaction index
    const existingIdx = post.reactions.findIndex((r) => r.userId.toString() === userId.toString());

    if (existingIdx !== -1) {
      if (post.reactions[existingIdx].emoji === emoji) {
        post.reactions.splice(existingIdx, 1); // Toggle off
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

module.exports = {
  getChannels,
  createChannel,
  toggleFollowChannel,
  getChannelPosts,
  createChannelPost,
  reactToChannelPost,
};
