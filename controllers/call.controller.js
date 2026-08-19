const Call = require('../models/Call');
const Message = require('../models/Message');

// Helper function to save a call log to DB and create a chat call-log message
const saveCallRecord = async ({ callerId, receiverId, type, status, duration = 0, startedAt }) => {
  try {
    const call = await Call.create({
      callerId,
      receiverId,
      type: type || 'voice',
      status: status || 'missed',
      duration: duration || 0,
      startedAt: startedAt || new Date(),
    });

    const populatedCall = await Call.findById(call._id)
      .populate('callerId', 'name avatarUrl email')
      .populate('receiverId', 'name avatarUrl email');

    // Create call-log message in 1-on-1 chat history
    let textStatus = '';
    if (status === 'answered') {
      const mins = Math.floor(duration / 60);
      const secs = duration % 60;
      const durStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
      textStatus = `${type === 'video' ? 'Video' : 'Voice'} call ended (${durStr})`;
    } else if (status === 'declined') {
      textStatus = `Declined ${type} call`;
    } else {
      textStatus = `Missed ${type} call`;
    }

    await Message.create({
      senderId: callerId,
      receiverId,
      chatId: receiverId,
      type: 'call-log',
      text: textStatus,
      callLog: {
        callId: call._id.toString(),
        callType: type,
        status,
        duration: duration || 0,
      },
    });

    return populatedCall;
  } catch (error) {
    console.error('Error saving call record:', error);
    return null;
  }
};

// @desc    Get user's call history
// @route   GET /api/calls
// @access  Private
const getCallLogs = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const calls = await Call.find({
      $or: [{ callerId: userId }, { receiverId: userId }],
    })
      .sort({ createdAt: -1 })
      .populate('callerId', 'name avatarUrl email')
      .populate('receiverId', 'name avatarUrl email')
      .limit(100);

    res.status(200).json({
      success: true,
      calls,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a call log entry via HTTP API
// @route   POST /api/calls
// @access  Private
const createCallLog = async (req, res, next) => {
  try {
    const { receiverId, type, status, duration } = req.body;
    const callerId = req.user._id;

    const call = await saveCallRecord({
      callerId,
      receiverId,
      type,
      status,
      duration,
    });

    if (!call) {
      return res.status(500).json({ success: false, message: 'Failed to save call log' });
    }

    res.status(201).json({
      success: true,
      call,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCallLogs,
  createCallLog,
  saveCallRecord,
};
