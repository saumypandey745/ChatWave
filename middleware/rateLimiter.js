const rateLimit = require('express-rate-limit');

// Rate limiter for login attempts (max 10 requests per 15 min per IP)
const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many failed login attempts. Please try again after 15 minutes.',
  },
});

// Rate limiter for resend verification code (max 10 requests per 15 min per email/IP)
const resendVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.body && req.body.email ? req.body.email.toLowerCase().trim() : req.ip;
  },
  message: {
    success: false,
    message: 'Too many resend attempts. Please wait 15 minutes before requesting another verification code.',
  },
});

// Rate limiter for forgot password requests (max 10 requests per 15 min per email/IP)
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.body && req.body.email ? req.body.email.toLowerCase().trim() : req.ip;
  },
  message: {
    success: false,
    message: 'Too many password reset requests. Please try again after 15 minutes.',
  },
});

// Rate limiter for OTP verification attempts (max 10 requests per 15 min per email/IP)
const verifyOtpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.body && req.body.email ? req.body.email.toLowerCase().trim() : req.ip;
  },
  message: {
    success: false,
    message: 'Too many OTP verification attempts. Please try again after 15 minutes.',
  },
});

module.exports = {
  loginRateLimiter,
  resendVerificationLimiter,
  forgotPasswordLimiter,
  verifyOtpLimiter,
};
