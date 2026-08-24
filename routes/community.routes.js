const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const {
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
} = require('../controllers/community.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/', getCommunities);
router.post('/', createCommunity);
router.get('/invite/:inviteCode', getCommunityByInvite);
router.post('/join-by-invite/:inviteCode', joinCommunityByInvite);

router.put('/:id', updateCommunity);
router.delete('/:id', deleteCommunity);

router.post('/:id/groups', addGroupToCommunity);
router.post('/:id/add-existing-group', addExistingGroupToCommunity);
router.delete('/:id/groups/:groupId', removeGroupFromCommunity);
router.post('/:id/groups/:groupId/join', joinCommunityGroup);

router.get('/:id/members-aggregate', getCommunityMembersAggregate);
router.post('/:id/requests/:applicantId/:action', handleJoinRequest);
router.post('/:id/admins/:action', promoteDemoteCommunityAdmin);
router.post('/:id/members/remove', removeMemberFromCommunity);
router.post('/:id/exit', exitCommunity);
router.post('/:id/revoke-invite', revokeInviteLink);

module.exports = router;
