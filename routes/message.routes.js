const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const {
  getMessages,
  sendMessage,
  toggleReaction,
  toggleStarMessage,
  forwardMessage,
  getStarredMessages,
  searchMessages,
  handleViewOnce,
  getMessageInfo,
  votePoll,
  endPoll,
  clearChat,
  deleteChat,
} = require('../controllers/message.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/starred', getStarredMessages);
router.get('/search', searchMessages);
router.get('/info/:messageId', getMessageInfo);

router.post('/chat/:chatId/clear', clearChat);
router.delete('/chat/:chatId', deleteChat);

router.get('/:chatId', getMessages);
router.post('/:chatId', upload.single('media'), sendMessage);
router.post('/:messageId/reaction', toggleReaction);
router.post('/:messageId/star', toggleStarMessage);
router.post('/:messageId/forward', forwardMessage);
router.post('/:messageId/view-once', handleViewOnce);
router.post('/:messageId/poll-vote', votePoll);
router.post('/:messageId/poll-end', endPoll);

module.exports = router;
