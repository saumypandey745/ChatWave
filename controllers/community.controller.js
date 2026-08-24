const crypto = require('crypto');
const Community = require('../models/Community');
const Group = require('../models/Group');
const User = require('../models/User');
const { io } = require('../socket/socket');

// Helper to check if user is community admin
const isCommunityAdmin = (community, userId) => {
  const uStr = userId.toString();
  if (community.creatorId.toString() === uStr) return true;
  if (community.communityAdmins && community.communityAdmins.some((a) => a.toString() === uStr)) return true;
  if (community.admins && community.admins.some((a) => a.toString() === uStr)) return true;
  return false;
};

// @desc    Get all communities for current user
// @route   GET /api/communities
// @access  Private
const getCommunities = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const communities = await Community.find({
      $or: [
        { creatorId: userId },
        { admins: userId },
        { communityAdmins: userId },
        { members: userId },
      ],
    })
      .populate('creatorId', 'name email avatarUrl chatwaveId')
      .populate('admins', 'name email avatarUrl chatwaveId')
      .populate('communityAdmins', 'name email avatarUrl chatwaveId')
      .populate('members', 'name email avatarUrl chatwaveId')
      .populate('pendingMembers', 'name email avatarUrl chatwaveId')
      .populate('groups', 'name iconUrl description members permissions isOpenToJoin isAnnouncementsGroup')
      .populate('announcementsGroupId')
      .sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      communities,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create new Community + Auto-create Announcements Group + Optionally attach existing groups
// @route   POST /api/communities
// @access  Private
const createCommunity = async (req, res, next) => {
  try {
    const { name, description, iconUrl, existingGroupIds } = req.body;
    const userId = req.user._id;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Community name is required' });
    }

    const inviteCode = crypto.randomBytes(8).toString('hex');

    // 1. Create Community Document
    const community = await Community.create({
      name: name.trim(),
      description: description ? description.trim() : '',
      iconUrl: iconUrl || undefined,
      creatorId: userId,
      admins: [userId],
      communityAdmins: [userId],
      members: [userId],
      pendingMembers: [],
      groups: [],
      inviteCode,
      inviteRevoked: false,
      settings: {
        whoCanAddGroups: 'admins',
        requiresApproval: false,
        whoCanInvite: 'everyone',
      },
    });

    // 2. Auto-create "Announcements" Group
    const announcementsGroup = await Group.create({
      name: `${community.name} Announcements`,
      description: `Official announcements for ${community.name} community. Only admins can post.`,
      iconUrl: community.iconUrl,
      createdBy: userId,
      communityId: community._id,
      isAnnouncementsGroup: true,
      isOpenToJoin: true,
      inviteCode: crypto.randomBytes(8).toString('hex'),
      members: [
        {
          userId: userId,
          role: 'admin',
          joinedAt: new Date(),
        },
      ],
      permissions: {
        sendMessages: 'admins',
        editGroupInfo: 'admins',
      },
    });

    community.announcementsGroupId = announcementsGroup._id;
    community.groups.push(announcementsGroup._id);

    // 3. Attach existing groups if provided and valid
    if (Array.isArray(existingGroupIds) && existingGroupIds.length > 0) {
      const validGroups = await Group.find({
        _id: { $in: existingGroupIds },
        'members.userId': userId,
        'members.role': 'admin',
      });

      const memberSet = new Set(community.members.map((m) => m.toString()));

      for (const grp of validGroups) {
        grp.communityId = community._id;
        await grp.save();
        if (!community.groups.includes(grp._id)) {
          community.groups.push(grp._id);
        }
        grp.members.forEach((m) => memberSet.add(m.userId.toString()));
      }
      community.members = Array.from(memberSet);
    }

    await community.save();

    const populated = await Community.findById(community._id)
      .populate('creatorId', 'name email avatarUrl chatwaveId')
      .populate('admins', 'name email avatarUrl chatwaveId')
      .populate('communityAdmins', 'name email avatarUrl chatwaveId')
      .populate('members', 'name email avatarUrl chatwaveId')
      .populate('pendingMembers', 'name email avatarUrl chatwaveId')
      .populate('groups')
      .populate('announcementsGroupId');

    res.status(201).json({
      success: true,
      message: 'Community created successfully!',
      community: populated,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update Community Info and Settings
// @route   PUT /api/communities/:id
// @access  Private (Community Admin)
const updateCommunity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, iconUrl, settings } = req.body;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can edit community details' });
    }

    if (name && name.trim()) community.name = name.trim();
    if (description !== undefined) community.description = description.trim();
    if (iconUrl !== undefined) community.iconUrl = iconUrl;
    if (settings) {
      if (settings.whoCanAddGroups) community.settings.whoCanAddGroups = settings.whoCanAddGroups;
      if (settings.requiresApproval !== undefined) community.settings.requiresApproval = Boolean(settings.requiresApproval);
      if (settings.whoCanInvite) community.settings.whoCanInvite = settings.whoCanInvite;
    }

    await community.save();

    const updated = await Community.findById(id)
      .populate('creatorId', 'name email avatarUrl chatwaveId')
      .populate('admins', 'name email avatarUrl chatwaveId')
      .populate('communityAdmins', 'name email avatarUrl chatwaveId')
      .populate('members', 'name email avatarUrl chatwaveId')
      .populate('pendingMembers', 'name email avatarUrl chatwaveId')
      .populate('groups')
      .populate('announcementsGroupId');

    // Notify community members over socket
    community.members.forEach((mId) => {
      io.to(`user:${mId.toString()}`).emit('community-updated', updated);
    });

    res.status(200).json({
      success: true,
      message: 'Community updated successfully',
      community: updated,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Create a new sub-group within a community
// @route   POST /api/communities/:id/groups
// @access  Private
const addGroupToCommunity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, isOpenToJoin } = req.body;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    // Check permission setting
    if (community.settings?.whoCanAddGroups === 'admins' && !isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can add new groups' });
    }

    const groupMembers = community.members.map((mId) => ({
      userId: mId,
      role: mId.toString() === userId.toString() ? 'admin' : 'member',
      joinedAt: new Date(),
    }));

    const newGroup = await Group.create({
      name: name ? name.trim() : `${community.name} Sub-Group`,
      description: description ? description.trim() : `Sub-group of ${community.name}`,
      iconUrl: community.iconUrl,
      createdBy: userId,
      communityId: community._id,
      isOpenToJoin: isOpenToJoin !== undefined ? Boolean(isOpenToJoin) : true,
      inviteCode: crypto.randomBytes(8).toString('hex'),
      members: groupMembers,
    });

    community.groups.push(newGroup._id);
    await community.save();

    const populatedGroup = await Group.findById(newGroup._id).populate('members.userId', 'name avatarUrl email');

    res.status(201).json({
      success: true,
      message: 'Sub-group added to community successfully',
      group: populatedGroup,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add an existing standalone group into a community
// @route   POST /api/communities/:id/add-existing-group
// @access  Private
const addExistingGroupToCommunity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { groupId } = req.body;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can attach existing groups' });
    }

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    const isGroupAdmin = group.members.some(
      (m) => m.userId.toString() === userId.toString() && m.role === 'admin'
    );
    if (!isGroupAdmin && group.createdBy.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'You must be an admin of the group to add it to a community' });
    }

    group.communityId = community._id;
    await group.save();

    if (!community.groups.some((g) => g.toString() === group._id.toString())) {
      community.groups.push(group._id);
    }

    // Merge group members into community members
    const memberSet = new Set(community.members.map((m) => m.toString()));
    group.members.forEach((m) => memberSet.add(m.userId.toString()));
    community.members = Array.from(memberSet);

    await community.save();

    res.status(200).json({
      success: true,
      message: 'Group attached to community successfully',
      group,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Detach/Remove a sub-group from community (group becomes standalone again)
// @route   DELETE /api/communities/:id/groups/:groupId
// @access  Private (Community Admin)
const removeGroupFromCommunity = async (req, res, next) => {
  try {
    const { id, groupId } = req.params;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can remove groups' });
    }

    if (community.announcementsGroupId && community.announcementsGroupId.toString() === groupId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot remove official Announcements group from community' });
    }

    community.groups = community.groups.filter((gId) => gId.toString() !== groupId.toString());
    await community.save();

    // Detach group document (do NOT delete group)
    const group = await Group.findById(groupId);
    if (group) {
      group.communityId = null;
      await group.save();
    }

    res.status(200).json({
      success: true,
      message: 'Group detached from community successfully',
      groupId,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get aggregate deduplicated community members with group listings
// @route   GET /api/communities/:id/members-aggregate
// @access  Private
const getCommunityMembersAggregate = async (req, res, next) => {
  try {
    const { id } = req.params;
    const community = await Community.findById(id).populate('groups', 'name iconUrl members');

    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const memberMap = new Map();

    for (const memberId of community.members) {
      const uIdStr = memberId.toString();
      const user = await User.findById(memberId).select('name email avatarUrl chatwaveId status customStatus');
      if (user) {
        const isCreator = community.creatorId.toString() === uIdStr;
        const isAdmin = isCommunityAdmin(community, memberId);

        memberMap.set(uIdStr, {
          _id: user._id,
          name: user.name,
          email: user.email,
          avatarUrl: user.avatarUrl,
          chatwaveId: user.chatwaveId,
          status: user.status,
          customStatus: user.customStatus,
          isCreator,
          isCommunityAdmin: isAdmin,
          groups: [],
        });
      }
    }

    // Populate group memberships per member
    if (community.groups && community.groups.length > 0) {
      for (const grp of community.groups) {
        if (!grp.members) continue;
        for (const m of grp.members) {
          const mIdStr = m.userId.toString();
          if (memberMap.has(mIdStr)) {
            memberMap.get(mIdStr).groups.push({
              _id: grp._id,
              name: grp.name,
              iconUrl: grp.iconUrl,
              role: m.role,
            });
          }
        }
      }
    }

    const membersList = Array.from(memberMap.values());

    res.status(200).json({
      success: true,
      members: membersList,
      totalCount: membersList.length,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get Community Info by Invite Link Code
// @route   GET /api/communities/invite/:inviteCode
// @access  Private
const getCommunityByInvite = async (req, res, next) => {
  try {
    const { inviteCode } = req.params;
    const community = await Community.findOne({ inviteCode })
      .populate('creatorId', 'name avatarUrl')
      .populate('groups', 'name iconUrl description members isOpenToJoin')
      .populate('announcementsGroupId');

    if (!community || community.inviteRevoked) {
      return res.status(404).json({ success: false, message: 'Invalid or expired community invite link' });
    }

    res.status(200).json({
      success: true,
      community: {
        _id: community._id,
        name: community.name,
        description: community.description,
        iconUrl: community.iconUrl,
        memberCount: community.members.length,
        requiresApproval: community.settings?.requiresApproval || false,
        groups: community.groups,
      },
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Join Community via Invite Code
// @route   POST /api/communities/join-by-invite/:inviteCode
// @access  Private
const joinCommunityByInvite = async (req, res, next) => {
  try {
    const { inviteCode } = req.params;
    const userId = req.user._id;

    const community = await Community.findOne({ inviteCode });
    if (!community || community.inviteRevoked) {
      return res.status(404).json({ success: false, message: 'Invalid or revoked invite link' });
    }

    const isMember = community.members.some((mId) => mId.toString() === userId.toString());
    if (isMember) {
      return res.status(200).json({ success: true, message: 'You are already a member of this community', community });
    }

    // Check if join approval is required
    if (community.settings?.requiresApproval) {
      if (!community.pendingMembers.some((pId) => pId.toString() === userId.toString())) {
        community.pendingMembers.push(userId);
        await community.save();
      }

      // Notify community admins via socket
      community.communityAdmins.forEach((aId) => {
        io.to(`user:${aId.toString()}`).emit('community-join-request', {
          communityId: community._id,
          user: { _id: req.user._id, name: req.user.name, avatarUrl: req.user.avatarUrl },
        });
      });

      return res.status(200).json({
        success: true,
        requiresApproval: true,
        message: 'Join request submitted for admin approval.',
      });
    }

    // Add user to community members
    community.members.push(userId);
    await community.save();

    // Auto-add to announcements group
    if (community.announcementsGroupId) {
      const annGroup = await Group.findById(community.announcementsGroupId);
      if (annGroup) {
        if (!annGroup.members.some((m) => m.userId.toString() === userId.toString())) {
          annGroup.members.push({ userId, role: 'member', joinedAt: new Date() });
          await annGroup.save();
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Joined community successfully!',
      community,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Approve / Reject Community Join Request
// @route   POST /api/communities/:id/requests/:applicantId/:action
// @access  Private (Community Admin)
const handleJoinRequest = async (req, res, next) => {
  try {
    const { id, applicantId, action } = req.params; // action = 'approve' | 'reject'
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can review join requests' });
    }

    community.pendingMembers = community.pendingMembers.filter((pId) => pId.toString() !== applicantId.toString());

    if (action === 'approve') {
      if (!community.members.some((mId) => mId.toString() === applicantId.toString())) {
        community.members.push(applicantId);
      }

      // Add to announcements group
      if (community.announcementsGroupId) {
        const annGroup = await Group.findById(community.announcementsGroupId);
        if (annGroup) {
          if (!annGroup.members.some((m) => m.userId.toString() === applicantId.toString())) {
            annGroup.members.push({ userId: applicantId, role: 'member', joinedAt: new Date() });
            await annGroup.save();
          }
        }
      }

      io.to(`user:${applicantId}`).emit('community-request-approved', { communityId: community._id, communityName: community.name });
    } else {
      io.to(`user:${applicantId}`).emit('community-request-rejected', { communityId: community._id, communityName: community.name });
    }

    await community.save();

    res.status(200).json({
      success: true,
      message: `Join request ${action}d successfully`,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Promote or Demote Community Admin
// @route   POST /api/communities/:id/admins/:action
// @access  Private (Community Creator / Admin)
const promoteDemoteCommunityAdmin = async (req, res, next) => {
  try {
    const { id, action } = req.params; // 'promote' | 'demote'
    const { targetUserId } = req.body;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can manage roles' });
    }

    if (action === 'demote' && community.creatorId.toString() === targetUserId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot demote the community creator' });
    }

    if (action === 'promote') {
      if (!community.communityAdmins.some((a) => a.toString() === targetUserId.toString())) {
        community.communityAdmins.push(targetUserId);
      }
      if (!community.admins.some((a) => a.toString() === targetUserId.toString())) {
        community.admins.push(targetUserId);
      }
    } else {
      community.communityAdmins = community.communityAdmins.filter((a) => a.toString() !== targetUserId.toString());
      community.admins = community.admins.filter((a) => a.toString() !== targetUserId.toString());
    }

    await community.save();

    res.status(200).json({
      success: true,
      message: `Member ${action}d successfully`,
      communityAdmins: community.communityAdmins,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Remove member from entire community (removes from all sub-groups)
// @route   POST /api/communities/:id/members/remove
// @access  Private (Community Admin)
const removeMemberFromCommunity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can remove members' });
    }

    if (community.creatorId.toString() === targetUserId.toString()) {
      return res.status(400).json({ success: false, message: 'Cannot remove community creator' });
    }

    // Pull from community arrays
    community.members = community.members.filter((m) => m.toString() !== targetUserId.toString());
    community.communityAdmins = community.communityAdmins.filter((a) => a.toString() !== targetUserId.toString());
    community.admins = community.admins.filter((a) => a.toString() !== targetUserId.toString());
    community.pendingMembers = community.pendingMembers.filter((p) => p.toString() !== targetUserId.toString());
    await community.save();

    // Remove member from all sub-groups in this community
    await Group.updateMany(
      { communityId: id },
      { $pull: { members: { userId: targetUserId } } }
    );

    // Notify member over socket
    io.to(`user:${targetUserId}`).emit('community-removed', { communityId: id, communityName: community.name });

    res.status(200).json({
      success: true,
      message: 'Member removed from community and all sub-groups',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Exit/Leave Community (leaves all sub-groups)
// @route   POST /api/communities/:id/exit
// @access  Private
const exitCommunity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (community.creatorId.toString() === userId.toString()) {
      return res.status(400).json({ success: false, message: 'Community creator cannot exit. Delete community instead.' });
    }

    community.members = community.members.filter((m) => m.toString() !== userId.toString());
    community.communityAdmins = community.communityAdmins.filter((a) => a.toString() !== userId.toString());
    community.admins = community.admins.filter((a) => a.toString() !== userId.toString());
    await community.save();

    // Pull user from all groups in this community
    await Group.updateMany(
      { communityId: id },
      { $pull: { members: { userId } } }
    );

    res.status(200).json({
      success: true,
      message: 'Exited community successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Revoke/Reset Community Invite Link
// @route   POST /api/communities/:id/revoke-invite
// @access  Private (Community Admin)
const revokeInviteLink = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can reset invite links' });
    }

    community.inviteCode = crypto.randomBytes(8).toString('hex');
    community.inviteRevoked = false;
    await community.save();

    res.status(200).json({
      success: true,
      message: 'Invite link reset successfully',
      inviteCode: community.inviteCode,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete Community (Deletes Announcements group, detaches all other sub-groups)
// @route   DELETE /api/communities/:id
// @access  Private (Community Admin / Creator)
const deleteCommunity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    if (!isCommunityAdmin(community, userId)) {
      return res.status(403).json({ success: false, message: 'Only Community Admins can delete the community' });
    }

    // 1. Delete official Announcements Group
    if (community.announcementsGroupId) {
      await Group.findByIdAndDelete(community.announcementsGroupId);
    }

    // 2. Detach all sub-groups so they become standalone again
    await Group.updateMany(
      { communityId: id },
      { $set: { communityId: null } }
    );

    // 3. Broadcast deletion event to all community members
    community.members.forEach((mId) => {
      io.to(`user:${mId.toString()}`).emit('community-deleted', { communityId: id, communityName: community.name });
    });

    // 4. Delete Community Document
    await Community.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Community deleted successfully. Sub-groups have been detached as standalone groups.',
      deletedId: id,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Join a community sub-group
// @route   POST /api/communities/:id/groups/:groupId/join
// @access  Private
const joinCommunityGroup = async (req, res, next) => {
  try {
    const { id, groupId } = req.params;
    const userId = req.user._id;

    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).json({ success: false, message: 'Group not found' });
    }

    if (!group.isOpenToJoin && group.createdBy.toString() !== userId.toString()) {
      return res.status(403).json({ success: false, message: 'This group is invite-only by group admins' });
    }

    const isMember = group.members.some((m) => m.userId.toString() === userId.toString());
    if (!isMember) {
      group.members.push({ userId, role: 'member', joinedAt: new Date() });
      await group.save();
    }

    res.status(200).json({
      success: true,
      message: 'Joined group successfully',
      group,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getCommunities,
  createCommunity,
  updateCommunity,
  addGroupToCommunity,
  addExistingGroupToCommunity,
  removeGroupFromCommunity,
  getCommunityMembersAggregate,
  getCommunityByInvite,
  joinCommunityByInvite,
  handleJoinRequest,
  promoteDemoteCommunityAdmin,
  removeMemberFromCommunity,
  exitCommunity,
  revokeInviteLink,
  deleteCommunity,
  joinCommunityGroup,
};
