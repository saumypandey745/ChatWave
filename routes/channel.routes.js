const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const {
  getChannels,
  createChannel,
  toggleFollowChannel,
  getChannelPosts,
  createChannelPost,
  reactToChannelPost,
} = require('../controllers/channel.controller');

const router = express.Router();

router.use(protectRoute);
router.get('/', getChannels);
router.post('/', createChannel);
router.post('/:id/follow', toggleFollowChannel);
router.get('/:id/posts', getChannelPosts);
router.post('/:id/posts', createChannelPost);
router.post('/:id/posts/:postId/react', reactToChannelPost);

module.exports = router;
