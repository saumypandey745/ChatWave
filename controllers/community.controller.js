const crypto = require('crypto');
const Community = require('../models/Community');
const Group = require('../models/Group');
const User = require('../models/User');

// @desc    Get all communities for current user
// @route   GET /api/communities
// @access  Private
const getCommunities = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const communities = await Community.find({
      $or: [{ creatorId: userId }, { admins: userId }, { members: userId }],
    })
      .populate('admins', 'name email avatarUrl chatwaveId')
      .populate('members', 'name email avatarUrl chatwaveId')
      .populate('groups', 'name iconUrl description members permissions')
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

// @desc    Create new Community + Auto-create Announcements Group
// @route   POST /api/communities
// @access  Private
const createCommunity = async (req, res, next) => {
  try {
    const { name, description, iconUrl } = req.body;
    const userId = req.user._id;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Community name is required' });
    }

    // 1. Create Community Document
    const community = await Community.create({
      name: name.trim(),
      description: description ? description.trim() : '',
      iconUrl: iconUrl || undefined,
      creatorId: userId,
      admins: [userId],
      members: [userId],
      groups: [],
    });

    // 2. Auto-create "Announcements" Group (Admins Only Can Post)
    const announcementsGroup = await Group.create({
      name: `${community.name} Announcements`,
      description: `Official announcements for ${community.name} community. Only admins can post.`,
      iconUrl: community.iconUrl,
      createdBy: userId,
      communityId: community._id,
      isAnnouncementsGroup: true,
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

    // 3. Link Announcements Group to Community
    community.announcementsGroupId = announcementsGroup._id;
    community.groups.push(announcementsGroup._id);
    await community.save();

    const populated = await Community.findById(community._id)
      .populate('admins', 'name email avatarUrl chatwaveId')
      .populate('members', 'name email avatarUrl chatwaveId')
      .populate('groups')
      .populate('announcementsGroupId');

    res.status(201).json({
      success: true,
      message: 'Community created with Announcements group!',
      community: populated,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Add a sub-group to community
// @route   POST /api/communities/:id/groups
// @access  Private (Community Admin)
const addGroupToCommunity = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const userId = req.user._id;

    const community = await Community.findById(id);
    if (!community) {
      return res.status(404).json({ success: false, message: 'Community not found' });
    }

    const isAdmin = community.admins.some((a) => a.toString() === userId.toString());
    if (!isAdmin) {
      return res.status(403).json({ success: false, message: 'Only community admins can add groups' });
    }

    // Create sub-group with all community members auto-added
    const groupMembers = community.members.map((mId) => ({
      userId: mId,
      role: mId.toString() === userId.toString() ? 'admin' : 'member',
      joinedAt: new Date(),
    }));

    const newGroup = await Group.create({
      name: name ? name.trim() : `${community.name} Group`,
      description: description ? description.trim() : `Sub-group of ${community.name}`,
      iconUrl: community.iconUrl,
      createdBy: userId,
      communityId: community._id,
      inviteCode: crypto.randomBytes(8).toString('hex'),
      members: groupMembers,
    });

    community.groups.push(newGroup._id);
    await community.save();

    res.status(201).json({
      success: true,
      message: 'Sub-group added to community successfully',
      group: newGroup,
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
  addGroupToCommunity,
  joinCommunityGroup,
};
