const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const {
  getProfile,
  updateProfile,
  updateSettings,
  searchUsers,
  getContacts,
  toggleBlockUser,
  getBlockedUsers,
  updatePrivacySettings,
  setupTwoStepPin,
  savePushSubscription,
  exportChatHistory,
} = require('../controllers/user.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/profile', getProfile);
router.put('/profile', upload.single('avatar'), updateProfile);
router.put('/settings', updateSettings);
router.get('/search', searchUsers);
router.get('/contacts', getContacts);

router.post('/block/:targetUserId', toggleBlockUser);
router.get('/blocked', getBlockedUsers);
router.put('/privacy', updatePrivacySettings);
router.post('/two-step-pin', setupTwoStepPin);
router.post('/push-subscription', savePushSubscription);
router.get('/export-chat/:chatId', exportChatHistory);

module.exports = router;
