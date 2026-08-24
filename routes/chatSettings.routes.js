const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const {
  getAllChatSettings,
  updateChatSettings,
  toggleChatLock,
  verifyChatPin,
} = require('../controllers/chatSettings.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/', getAllChatSettings);
router.put('/:chatId', upload.single('wallpaper'), updateChatSettings);
router.post('/:chatId/lock', toggleChatLock);
router.post('/:chatId/verify-pin', verifyChatPin);

module.exports = router;
