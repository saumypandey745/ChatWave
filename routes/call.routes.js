const express = require('express');
const protectRoute = require('../middleware/protectRoute');
const { getCallLogs, createCallLog } = require('../controllers/call.controller');

const router = express.Router();

router.use(protectRoute);

router.get('/', getCallLogs);
router.post('/', createCallLog);

module.exports = router;
