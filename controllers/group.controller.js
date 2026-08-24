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

// @desc    Delete group (ANY Admin)
// @route   DELETE /api/groups/:groupId
// @access  Private (Admin only)
const deleteGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const member = group.members.find((m) => m.userId.toString() === userId.toString());
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can delete this group' });
    }

    const memberUserIds = group.members.map((m) => m.userId.toString());

    // Delete group & group messages
    await Group.findByIdAndDelete(groupId);
    await Message.deleteMany({ chatId: groupId });

    if (io) {
      io.to(`group:${groupId}`).emit('groupDeleted', { groupId });
      memberUserIds.forEach((mId) => {
        io.to(`user:${mId}`).emit('groupDeleted', { groupId });
      });
    }

    res.status(200).json({
      success: true,
      message: 'Group deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Report group
// @route   POST /api/groups/:groupId/report
// @access  Private
const reportGroup = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { reason } = req.body;
    const reporterId = req.user._id;

    const mongoose = require('mongoose');
    if (!groupId || !mongoose.Types.ObjectId.isValid(groupId)) {
      return res.status(400).json({ success: false, message: 'Invalid group ID' });
    }

    const Report = require('../models/Report');
    const report = await Report.create({
      reporterId,
      targetId: new mongoose.Types.ObjectId(groupId),
      targetType: 'group',
      reason: reason || 'Reported group for inappropriate content',
    });

    res.status(201).json({
      success: true,
      message: 'Report submitted. Thank you for helping keep ChatWave safe.',
      report,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get or generate group invite link
// @route   GET /api/groups/:groupId/invite-link
// @access  Private (Admin only)
const getInviteLink = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const crypto = require('crypto');

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    if (!group.inviteCode) {
      group.inviteCode = crypto.randomBytes(8).toString('hex');
      await group.save();
    }

    res.status(200).json({
      success: true,
      inviteCode: group.inviteCode,
      inviteRevoked: group.inviteRevoked,
      requiresAdminApproval: group.requiresAdminApproval,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset group invite link (generate new code)
// @route   POST /api/groups/:groupId/invite-link/reset
// @access  Private (Admin only)
const resetInviteLink = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const crypto = require('crypto');

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const member = group.members.find((m) => m.userId.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can reset invite link' });
    }

    group.inviteCode = crypto.randomBytes(8).toString('hex');
    group.inviteRevoked = false;
    await group.save();

    res.status(200).json({
      success: true,
      message: 'Invite link reset successfully',
      inviteCode: group.inviteCode,
      inviteRevoked: false,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Revoke group invite link
// @route   POST /api/groups/:groupId/invite-link/revoke
// @access  Private (Admin only)
const revokeInviteLink = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const member = group.members.find((m) => m.userId.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can revoke invite link' });
    }

    group.inviteRevoked = true;
    await group.save();

    res.status(200).json({
      success: true,
      message: 'Invite link revoked successfully',
      inviteRevoked: true,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Join group via invite link
// @route   POST /api/groups/join/:inviteCode
// @access  Private
const joinByInviteCode = async (req, res, next) => {
  try {
    const { inviteCode } = req.params;
    const userId = req.user._id;

    const group = await Group.findOne({ inviteCode });
    if (!group) {
      return res.status(404).json({ success: false, message: 'Invalid group invite link' });
    }

    if (group.inviteRevoked) {
      return res.status(400).json({ success: false, message: 'This invite link has been revoked' });
    }

    const isMember = group.members.some((m) => m.userId.toString() === userId.toString());
    if (isMember) {
      return res.status(200).json({ success: true, message: 'Already a member', group });
    }

    if (group.requiresAdminApproval) {
      const isPending = group.pendingMembers?.some((id) => id.toString() === userId.toString());
      if (!isPending) {
        group.pendingMembers.push(userId);
        await group.save();
      }
      return res.status(200).json({
        success: true,
        pendingApproval: true,
        message: 'Request sent! Waiting for admin approval.',
      });
    }

    group.members.push({ userId, role: 'member', joinedAt: new Date() });
    await group.save();

    await createSystemMessage(group._id, `${req.user.name} joined via invite link`, userId);

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${group._id}`).emit('groupUpdated', updatedGroup);
      io.to(`user:${userId}`).emit('groupCreated', updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: 'Joined group successfully',
      group: updatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Toggle admin approval requirement for joining via link
// @route   PUT /api/groups/:groupId/approval-setting
// @access  Private (Admin only)
const toggleAdminApproval = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { requiresAdminApproval } = req.body;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const member = group.members.find((m) => m.userId.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can update approval settings' });
    }

    group.requiresAdminApproval = requiresAdminApproval;
    await group.save();

    res.status(200).json({
      success: true,
      requiresAdminApproval: group.requiresAdminApproval,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get pending members for group
// @route   GET /api/groups/:groupId/pending-members
// @access  Private (Admin only)
const getPendingMembers = async (req, res, next) => {
  try {
    const { groupId } = req.params;

    const group = await Group.findById(groupId).populate('pendingMembers', 'name email avatarUrl bio');
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const member = group.members.find((m) => m.userId.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can view pending members' });
    }

    res.status(200).json({
      success: true,
      pendingMembers: group.pendingMembers || [],
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve or reject a pending join request
// @route   POST /api/groups/:groupId/pending-members/:targetUserId/action
// @access  Private (Admin only)
const handlePendingMemberAction = async (req, res, next) => {
  try {
    const { groupId, targetUserId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const admin = group.members.find((m) => m.userId.toString() === req.user._id.toString());
    if (!admin || admin.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can approve/reject join requests' });
    }

    group.pendingMembers = (group.pendingMembers || []).filter(
      (id) => id.toString() !== targetUserId.toString()
    );

    if (action === 'approve') {
      const isAlreadyMember = group.members.some((m) => m.userId.toString() === targetUserId.toString());
      if (!isAlreadyMember) {
        group.members.push({ userId: targetUserId, role: 'member', joinedAt: new Date() });
      }
    }

    await group.save();

    if (action === 'approve') {
      const approvedUser = await User.findById(targetUserId).select('name');
      await createSystemMessage(
        group._id,
        `${req.user.name} approved join request for ${approvedUser ? approvedUser.name : 'a user'}`,
        req.user._id
      );
    }

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${groupId}`).emit('groupUpdated', updatedGroup);
      if (action === 'approve') {
        io.to(`user:${targetUserId}`).emit('groupCreated', updatedGroup);
      }
    }

    res.status(200).json({
      success: true,
      message: `Request ${action}d successfully`,
      group: updatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update group permissions (who can send messages, edit group info)
// @route   PUT /api/groups/:groupId/permissions
// @access  Private (Admin only)
const updateGroupPermissions = async (req, res, next) => {
  try {
    const { groupId } = req.params;
    const { sendMessages, editGroupInfo } = req.body;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found' });

    const member = group.members.find((m) => m.userId.toString() === req.user._id.toString());
    if (!member || member.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Only admins can change group permissions' });
    }

    if (sendMessages) group.permissions.sendMessages = sendMessages;
    if (editGroupInfo) group.permissions.editGroupInfo = editGroupInfo;

    await group.save();

    await createSystemMessage(group._id, `${req.user.name} updated group permissions`, req.user._id);

    const updatedGroup = await Group.findById(group._id).populate(
      'members.userId',
      'name email avatarUrl isOnline lastSeen'
    );

    if (io) {
      io.to(`group:${groupId}`).emit('groupUpdated', updatedGroup);
    }

    res.status(200).json({
      success: true,
      message: 'Permissions updated successfully',
      permissions: updatedGroup.permissions,
      group: updatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get all standalone groups where user is admin (for attaching to community)
// @route   GET /api/groups/my-admin-groups
// @access  Private
const getMyAdminGroups = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const groups = await Group.find({
      'members.userId': userId,
      'members.role': 'admin',
      $or: [{ communityId: null }, { communityId: { $exists: false } }],
      isAnnouncementsGroup: { $ne: true },
    }).select('name description iconUrl members');

    res.status(200).json({
      success: true,
      groups,
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
  deleteGroup,
  reportGroup,
  getInviteLink,
  resetInviteLink,
  revokeInviteLink,
  joinByInviteCode,
  toggleAdminApproval,
  getPendingMembers,
  handlePendingMemberAction,
  updateGroupPermissions,
  getMyAdminGroups,
};

