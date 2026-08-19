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
} = require('../controllers/message.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/starred', getStarredMessages);
router.get('/search', searchMessages);

router.get('/:chatId', getMessages);
router.post('/:chatId', upload.single('media'), sendMessage);
router.post('/:messageId/reaction', toggleReaction);
router.post('/:messageId/star', toggleStarMessage);
router.post('/:messageId/forward', forwardMessage);

module.exports = router;
