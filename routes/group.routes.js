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
} = require('../controllers/group.controller');

const router = express.Router();

router.use(protectRoute);

router.post('/', upload.single('icon'), createGroup);
router.get('/:groupId', getGroupDetails);
router.put('/:groupId', upload.single('icon'), updateGroup);
router.delete('/:groupId', deleteGroup);
router.post('/:groupId/report', reportGroup);
router.post('/:groupId/members', addMembers);
router.delete('/:groupId/members/:targetUserId', removeMember);
router.put('/:groupId/members/:targetUserId/role', updateMemberRole);
router.post('/:groupId/leave', leaveGroup);

module.exports = router;
