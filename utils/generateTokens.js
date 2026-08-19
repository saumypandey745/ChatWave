const jwt = require('jsonwebtoken');
const RefreshToken = require('../models/RefreshToken');

const generateAccessToken = (userId) => {
  return jwt.sign({ userId }, process.env.JWT_SECRET || 'fallback_jwt_secret', {
    expiresIn: '15m',
  });
};

const generateRefreshToken = async (userId, rememberMe = false, res) => {
  // Expiry duration: 30 days if rememberMe is true, else 7 days
  const expiresInDays = rememberMe ? 30 : 7;
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresInDays);

  const refreshToken = jwt.sign(
    { userId },
    process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret',
    { expiresIn: `${expiresInDays}d` }
  );

  // Save refresh token to database
  await RefreshToken.create({
    token: refreshToken,
    userId,
    expiresAt,
  });

  // Set httpOnly cookie
  if (res) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax', // Allow cookies in cross-origin / standard local requests
      maxAge: expiresInDays * 24 * 60 * 60 * 1000,
    });
  }

  return refreshToken;
};

module.exports = {
  generateAccessToken,
  generateRefreshToken,
};
