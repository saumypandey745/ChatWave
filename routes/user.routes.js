const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const {
  getProfile,
  updateProfile,
  updateSettings,
  addContact,
  updateContactNickname,
  searchUsers,
  getContacts,
  blockUser,
  unblockUser,
  toggleBlockUser,
  getBlockedUsers,
  updatePrivacySettings,
  setupTwoStepPin,
  savePushSubscription,
  reportUser,
  exportChatHistory,
} = require('../controllers/user.controller');

const router = express.Router();

router.use(protectRoute);

// ── Static routes FIRST (before any /:param routes) ──────────────────────────
router.get('/profile', getProfile);
router.put('/profile', upload.single('avatar'), updateProfile);
router.put('/settings', updateSettings);
router.get('/search', searchUsers);
router.get('/contacts', getContacts);
router.post('/contacts/add', addContact);
router.get('/blocked', getBlockedUsers);
router.put('/privacy', updatePrivacySettings);
router.post('/two-step-pin', setupTwoStepPin);
router.post('/push-subscription', savePushSubscription);

// ── Dynamic :param routes AFTER static routes ─────────────────────────────────
router.put('/contacts/:targetUserId/nickname', updateContactNickname);
router.get('/export-chat/:chatId', exportChatHistory);

router.post('/block/:targetUserId', toggleBlockUser);
router.post('/:targetUserId/block', blockUser);
router.post('/:targetUserId/unblock', unblockUser);
router.post('/:targetUserId/report', reportUser);

module.exports = router;
