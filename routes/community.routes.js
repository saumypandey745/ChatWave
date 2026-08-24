const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const {
  getCommunities,
  createCommunity,
  addGroupToCommunity,
  joinCommunityGroup,
} = require('../controllers/community.controller');

const router = express.Router();

router.use(protectRoute);
router.get('/', getCommunities);
router.post('/', createCommunity);
router.post('/:id/groups', addGroupToCommunity);
router.post('/:id/groups/:groupId/join', joinCommunityGroup);

module.exports = router;
