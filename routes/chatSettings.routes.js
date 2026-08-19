const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const { getAllChatSettings, updateChatSettings } = require('../controllers/chatSettings.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/', getAllChatSettings);
router.put('/:chatId', upload.single('wallpaper'), updateChatSettings);

module.exports = router;
