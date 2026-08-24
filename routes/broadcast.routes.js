const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { upload } = require('../config/cloudinary');
const {
  getBroadcastLists,
  createBroadcastList,
  updateBroadcastList,
  deleteBroadcastList,
  sendBroadcastMessage,
} = require('../controllers/broadcast.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/', getBroadcastLists);
router.post('/', createBroadcastList);
router.put('/:id', updateBroadcastList);
router.delete('/:id', deleteBroadcastList);
router.post('/:id/send', upload.single('media'), sendBroadcastMessage);

module.exports = router;
