const Group = require('../models/Group');
const Message = require('../models/Message');
const User = require('../models/User');
const { handleImageUpload } = require('../config/cloudinary');
const { io } = require('../socket/socket');

// Helper to create group system message
const createSystemMessage = async (groupId, text, senderId) => {
  const message = await Message.create({
    senderId,
    chatId: groupId.toString(),
    isGroup: true,
    type: 'system',
    text,
  });

  if (io) {
    io.to(`group:${groupId}`).emit('newMessage', message);
  }
  return message;
};

// @desc    Create a new group chat
// @route   POST /api/groups
// @access  Private
const createGroup = async (req, res, next) => {
  try {
    const { name, description, memberIds } = req.body;
    const creatorId = req.user._id;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Group name is required' });
    }

    let parsedMembers = [];
    if (typeof memberIds === 'string') {
      try { parsedMembers = JSON.parse(memberIds); } catch (e) { parsedMembers = [memberIds]; }
    } else if (Array.isArray(memberIds)) {
      parsedMembers = memberIds;
    }

    // Ensure creator is included as admin
    const members = [
      { userId: creatorId, role: 'admin', joinedAt: new Date() },
      ...parsedMembers
        .filter((id) => id.toString() !== creatorId.toString())
        .map((id) => ({ userId: id, role: 'member', joinedAt: new Date() })),
    ];

    let iconUrl = '';
    if (req.file) {
      iconUrl = await handleImageUpload(req.file, req);
    }

    const group = await Group.create({
      name: name.trim(),
      description: description ? description.trim() : '',
      iconUrl,
      members,
      createdBy: creatorId,
    });

    const populatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    // Send system message
    await createSystemMessage(group._id, `${req.user.name} created group "${group.name}"`, creatorId);

    // Notify online members via socket
    if (io) {
      members.forEach((m) => {
        io.to(`user:${m.userId}`).emit('groupCreated', populatedGroup);
      });
    }

    res.status(201).json({
      success: true,
      message: 'Group created successfully',
      group: populatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get details of a group
// @route   GET /api/groups/:groupId
// @access  Private
const getGroupDetails = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId).populate(
      'members.userId',
      'name email avatarUrl bio isOnline lastSeen hideOnlineStatus'
    );

    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    res.status(200).json({
      success: true,
      group,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update group name, description, icon
// @route   PUT /api/groups/:groupId
// @access  Private (Admin only)
const updateGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { name, description } = req.body;
    const userId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const member = group.members.find((m) => m.userId.toString() === userId.toString());
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can edit group info' });
    }

    if (name) group.name = name.trim();
    if (description !== undefined) group.description = description.trim();

    if (req.file) {
      const iconUrl = await handleImageUpload(req.file, req);
      if (iconUrl) group.iconUrl = iconUrl;
    }

    await group.save();

    await createSystemMessage(group._id, `${req.user.name} updated group info`, userId);

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${groupId}`).emit('groupUpdated', updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: 'Group updated',
      group: updatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add members to group
// @route   POST /api/groups/:groupId/members
// @access  Private (Admin only)
const addMembers = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { memberIds } = req.body;
    const adminId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const admin = group.members.find((m) => m.userId.toString() === adminId.toString());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can add members' });
    }

    const existingMemberIds = group.members.map((m) => m.userId.toString());
    const newMembers = memberIds.filter((id) => !existingMemberIds.includes(id.toString()));

    if (newMembers.length === 0) {
      return res.status(400).json({ success: false, message: 'Selected users are already members' });
    }

    newMembers.forEach((id) => {
      group.members.push({ userId: id, role: 'member', joinedAt: new Date() });
    });

    await group.save();

    const addedUsers = await User.find({ _id: { $in: newMembers } }).select('name');
    const addedNames = addedUsers.map((u) => u.name).join(', ');

    await createSystemMessage(group._id, `${req.user.name} added ${addedNames}`, adminId);

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${groupId}`).emit('groupUpdated', updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: 'Members added',
      group: updatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove a member from group
// @route   DELETE /api/groups/:groupId/members/:targetUserId
// @access  Private (Admin only)
const removeMember = async (req, res, next) => {
  try {
    const { groupId, targetUserId } = req.params;
    const adminId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const admin = group.members.find((m) => m.userId.toString() === adminId.toString());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can remove members' });
    }

    const targetUser = await User.findById(targetUserId);
    group.members = group.members.filter((m) => m.userId.toString() !== targetUserId.toString());
    await group.save();

    await createSystemMessage(
      group._id,
      `${req.user.name} removed ${targetUser ? targetUser.name : 'a member'}`,
      adminId
    );

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${groupId}`).emit('groupUpdated', updatedGroup);
      io.to(`user:${targetUserId}`).emit('removedFromGroup', { groupId });
    }

    res.status(200).json({
      success: true,
      message: 'Member removed',
      group: updatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Promote or demote member role
// @route   PUT /api/groups/:groupId/members/:targetUserId/role
// @access  Private (Admin only)
const updateMemberRole = async (req, res, next) => {
  try {
    const { groupId, targetUserId } = req.params;
    const { role } = req.body; // 'admin' or 'member'
    const adminId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const admin = group.members.find((m) => m.userId.toString() === adminId.toString());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can change roles' });
    }

    const member = group.members.find((m) => m.userId.toString() === targetUserId.toString());
    if (!member) return res.status(404).json({ success: false, message: 'Member not found in group' });

    member.role = role;
    await group.save();

    const targetUser = await User.findById(targetUserId);
    await createSystemMessage(
      group._id,
      `${req.user.name} ${role === 'admin' ? 'promoted' : 'demoted'} ${targetUser ? targetUser.name : 'a member'}`,
      adminId
    );

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${groupId}`).emit('groupUpdated', updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: 'Role updated',
      group: updatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Leave group
// @route   POST /api/groups/:groupId/leave
// @access  Private
const leaveGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    group.members = group.members.filter((m) => m.userId.toString() !== userId.toString());
    await group.save();

    await createSystemMessage(group._id, `${req.user.name} left the group`, userId);

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${groupId}`).emit('groupUpdated', updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: 'Left group successfully',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createGroup,
  getGroupDetails,
  updateGroup,
  addMembers,
  removeMember,
  updateMemberRole,
  leaveGroup,
};
