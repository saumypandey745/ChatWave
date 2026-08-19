const rateLimit = require('express-rate-limit');

// Rate limiter for login attempts (max 5 requests per 15 min per IP)
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 login requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed login attempts. Please try again after 15 minutes.',
  },
});

module.exports = {
  loginRateLimiter,
};
