const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const {
  generatePairingToken,
  linkDevice,
  getLinkedDevices,
  revokeDevice,
} = require('../controllers/device.controller');

const router = express.Router();

router.post('/link', linkDevice); // Public (authenticated via single-use pairing token)

router.use(protectRoute);
router.get('/', getLinkedDevices);
router.post('/generate-pairing-token', generatePairingToken);
router.delete('/:id', revokeDevice);

module.exports = router;
