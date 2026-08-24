const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const {
  getChannels,
  createChannel,
  updateChannel,
  promoteDemoteChannelAdmin,
  toggleFollowChannel,
  toggleMuteChannel,
  getChannelPosts,
  getChannelUpdatesFeed,
  createChannelPost,
  editChannelPost,
  deleteChannelPost,
  pinUnpinChannelPost,
  voteChannelPoll,
  reactToChannelPost,
  reportChannel,
} = require('../controllers/channel.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/', getChannels);
router.post('/', createChannel);
router.get('/updates-feed', getChannelUpdatesFeed);

router.put('/:id', updateChannel);
router.post('/:id/admins/:action', promoteDemoteChannelAdmin);
router.post('/:id/follow', toggleFollowChannel);
router.post('/:id/mute', toggleMuteChannel);
router.post('/:id/report', reportChannel);

router.get('/:id/posts', getChannelPosts);
router.post('/:id/posts', createChannelPost);
router.put('/:id/posts/:postId', editChannelPost);
router.delete('/:id/posts/:postId', deleteChannelPost);

router.post('/:id/posts/:postId/pin', pinUnpinChannelPost);
router.post('/:id/posts/:postId/poll-vote', voteChannelPoll);
router.post('/:id/posts/:postId/react', reactToChannelPost);

module.exports = router;
