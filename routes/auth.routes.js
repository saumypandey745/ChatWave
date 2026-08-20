const express = require('express');
const { body } = require('express-validator');
const {
  signup,
  verifyEmail,
  resendVerification,
  login,
  googleAuth,
  refreshToken,
  logout,
  forgotPassword,
  verifyResetOtp,
  resetPassword,
} = require('../controllers/auth.controller');
const {
  loginRateLimiter,
  resendVerificationLimiter,
  forgotPasswordLimiter,
  verifyOtpLimiter,
} = require('../middleware/rateLimiter');
const protectRoute = require('../middleware/protectRoute');

const router = express.Router();

// Signup Route with express-validator
router.post(
  '/signup',
  [
    body('name').trim().notEmpty().withMessage('Full Name is required'),
    body('email').isEmail().withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least 1 uppercase letter, 1 number, and 1 special character'),
  ],
  signup
);

// Verify Email Code Route
router.post(
  '/verify-email',
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('code').isLength({ min: 6, max: 6 }).withMessage('6-digit verification code is required'),
  ],
  verifyEmail
);

// Resend Email Verification Code Route (Rate limited)
router.post(
  '/resend-verification',
  resendVerificationLimiter,
  [body('email').isEmail().withMessage('Valid email is required')],
  resendVerification
);

// Login Route with rate limiter
router.post(
  '/login',
  loginRateLimiter,
  [
    body('email').isEmail().withMessage('Please enter a valid email address'),
    body('password').notEmpty().withMessage('Password is required'),
  ],
  login
);

// Google Sign In / Sign Up
router.post('/google', googleAuth);

// Refresh Token (uses httpOnly cookie)
router.post('/refresh', refreshToken);

// Logout
router.post('/logout', protectRoute, logout);

// Forgot Password OTP (Rate limited)
router.post(
  '/forgot-password',
  forgotPasswordLimiter,
  [body('email').isEmail().withMessage('Valid email is required')],
  forgotPassword
);

// Verify Password Reset OTP (Rate limited)
router.post(
  '/verify-reset-otp',
  verifyOtpLimiter,
  [
    body('email').isEmail().withMessage('Valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('6-digit OTP is required'),
  ],
  verifyResetOtp
);

// Reset Password
router.post(
  '/reset-password',
  [
    body('resetToken').notEmpty().withMessage('Reset token is required'),
    body('newPassword')
      .isLength({ min: 8 })
      .withMessage('Password must be at least 8 characters long')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('Password must contain at least 1 uppercase letter, 1 number, and 1 special character'),
  ],
  resetPassword
);

module.exports = router;
