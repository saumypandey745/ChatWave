const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const {
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
} = require('../controllers/group.controller');

const router = express.Router();

router.use(protectRoute);

router.post('/', upload.single('icon'), createGroup);
router.post('/join/:inviteCode', joinByInviteCode);

router.get('/:groupId', getGroupDetails);
router.put('/:groupId', upload.single('icon'), updateGroup);
router.delete('/:groupId', deleteGroup);
router.post('/:groupId/report', reportGroup);

router.get('/:groupId/invite-link', getInviteLink);
router.post('/:groupId/invite-link/reset', resetInviteLink);
router.post('/:groupId/invite-link/revoke', revokeInviteLink);

router.put('/:groupId/approval-setting', toggleAdminApproval);
router.get('/:groupId/pending-members', getPendingMembers);
router.post('/:groupId/pending-members/:targetUserId/action', handlePendingMemberAction);

router.put('/:groupId/permissions', updateGroupPermissions);

router.post('/:groupId/members', addMembers);
router.delete('/:groupId/members/:targetUserId', removeMember);
router.put('/:groupId/members/:targetUserId/role', updateMemberRole);
router.post('/:groupId/leave', leaveGroup);

module.exports = router;
