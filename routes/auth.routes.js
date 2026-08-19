const express = require('express');
const { body } = require('express-validator');
const {
  signup,
  login,
  googleAuth,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
} = require('../controllers/auth.controller');
const { loginRateLimiter } = require('../middleware/rateLimiter');
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

// Forgot & Reset Password
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
