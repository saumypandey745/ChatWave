const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const {
  postStatus,
  getStatusesFeed,
  getStatusPrivacy,
  updateStatusPrivacy,
  toggleMuteStatusUser,
  markStatusViewed,
  deleteStatus,
} = require('../controllers/status.controller');

const router = express.Router();

router.use(protectRoute);

router.post('/', upload.single('media'), postStatus);
router.get('/', getStatusesFeed);
router.get('/privacy', getStatusPrivacy);
router.post('/privacy', updateStatusPrivacy);
router.post('/mute-user', toggleMuteStatusUser);
router.post('/:statusId/view', markStatusViewed);
router.delete('/:statusId', deleteStatus);

module.exports = router;
