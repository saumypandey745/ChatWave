const User = require('../models/User');

const generateChatwaveId = async () => {
  let isUnique = false;
  let chatwaveId = '';

  while (!isUnique) {
    chatwaveId = Math.floor(1000000000 + Math.random() * 9000000000).toString();
    const existing = await User.findOne({ chatwaveId });
    if (!existing) {
      isUnique = true;
    }
  }

  return chatwaveId;
};

module.exports = generateChatwaveId;
