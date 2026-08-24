const BroadcastList = require('../models/BroadcastList');
const Message = require('../models/Message');
const User = require('../models/User');
const { getReceiverSocketId, io } = require('../socket/socket');
const { uploadToCloudinary } = require('../config/cloudinary');

// @desc    Get all broadcast lists for logged in user
// @route   GET /api/broadcasts
// @access  Private
const getBroadcastLists = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const lists = await BroadcastList.find({ ownerId })
      .populate('recipients', 'name email avatarUrl isOnline chatwaveId')
      .sort({ createdAt: -1 });

    res.status(200).json({ success: true, broadcastLists: lists });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new broadcast list
// @route   POST /api/broadcasts
// @access  Private
const createBroadcastList = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { name, recipients } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'List name is required' });
    }
    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one recipient is required' });
    }

    const newList = await BroadcastList.create({
      ownerId,
      name: name.trim(),
      recipients,
    });

    const populated = await BroadcastList.findById(newList._id).populate(
      'recipients',
      'name email avatarUrl isOnline chatwaveId'
    );

    res.status(201).json({ success: true, broadcastList: populated });
  } catch (error) {
    next(error);
  }
};

// @desc    Update broadcast list details / recipients
// @route   PUT /api/broadcasts/:id
// @access  Private
const updateBroadcastList = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;
    const { name, recipients } = req.body;

    const list = await BroadcastList.findOne({ _id: id, ownerId });
    if (!list) {
      return res.status(404).json({ success: false, message: 'Broadcast list not found' });
    }

    if (name) list.name = name.trim();
    if (recipients && Array.isArray(recipients)) list.recipients = recipients;

    await list.save();
    const populated = await BroadcastList.findById(list._id).populate(
      'recipients',
      'name email avatarUrl isOnline chatwaveId'
    );

    res.status(200).json({ success: true, broadcastList: populated });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a broadcast list
// @route   DELETE /api/broadcasts/:id
// @access  Private
const deleteBroadcastList = async (req, res, next) => {
  try {
    const ownerId = req.user._id;
    const { id } = req.params;

    const list = await BroadcastList.findOneAndDelete({ _id: id, ownerId });
    if (!list) {
      return res.status(404).json({ success: false, message: 'Broadcast list not found' });
    }

    res.status(200).json({ success: true, message: 'Broadcast list deleted' });
  } catch (error) {
    next(error);
  }
};

// @desc    Send broadcast message to all recipients as separate 1-on-1 messages
// @route   POST /api/broadcasts/:id/send
// @access  Private
const sendBroadcastMessage = async (req, res, next) => {
  try {
    const senderId = req.user._id;
    const { id } = req.params;
    const { text, type = 'text' } = req.body;

    const list = await BroadcastList.findOne({ _id: id, ownerId: senderId });
    if (!list) {
      return res.status(404).json({ success: false, message: 'Broadcast list not found' });
    }

    let mediaUrl = '';
    if (req.file) {
      mediaUrl = await uploadToCloudinary(req.file);
    }

    const createdMessages = [];

    // Loop through each recipient and send standard 1-on-1 message
    for (const recipientId of list.recipients) {
      const chatId = recipientId.toString();

      const newMsg = await Message.create({
        senderId,
        receiverId: recipientId,
        chatId,
        isGroup: false,
        type,
        text: text || '',
        imageUrl: mediaUrl,
        status: 'sent',
      });

      const populatedMsg = await Message.findById(newMsg._id)
        .populate('senderId', 'name email avatarUrl bio isOnline lastSeen hideOnlineStatus chatwaveId')
        .populate('receiverId', 'name email avatarUrl bio isOnline lastSeen hideOnlineStatus chatwaveId');

      createdMessages.push(populatedMsg);

      // Emit socket event to recipient as standard 1-on-1 message
      const receiverSockets = getReceiverSocketId(recipientId.toString());
      receiverSockets.forEach((socketId) => {
        io.to(socketId).emit('newMessage', populatedMsg);
      });
    }

    res.status(200).json({
      success: true,
      message: `Broadcast message sent to ${list.recipients.length} recipients`,
      sentCount: list.recipients.length,
      messages: createdMessages,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getBroadcastLists,
  createBroadcastList,
  updateBroadcastList,
  deleteBroadcastList,
  sendBroadcastMessage,
};
