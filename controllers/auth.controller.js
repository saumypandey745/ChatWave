const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { generateAccessToken, generateRefreshToken } = require('../utils/generateTokens');
const { verifyGoogleIdToken } = require('../config/googleClient');
const { sendPasswordResetEmail } = require('../utils/sendEmail');

// @desc    Register a new user
// @route   POST /api/auth/signup
// @access  Public
const signup = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array().map((err) => ({ field: err.path, msg: err.msg })),
      });
    }

    const { name, email, password, confirmPassword } = req.body;

    // Masked safe log (NEVER log raw passwords or credentials)
    const maskedEmail = email ? email.toLowerCase().replace(/(?<=^.{2}).+?(?=@)/, '***') : 'unknown';
    console.log(`[AUTH] Signup request received for email: ${maskedEmail}`);

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        errors: [{ field: 'confirmPassword', msg: 'Passwords do not match' }],
      });
    }

    // Check duplicate email
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        errors: [{ field: 'email', msg: 'Email already registered' }],
      });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Create user
    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      authProvider: 'local',
    });

    // Generate tokens (Auto-login)
    const accessToken = generateAccessToken(newUser._id);
    await generateRefreshToken(newUser._id, false, res);

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      accessToken,
      user: newUser.toJSON(),
    });
  } catch (error) {
    console.error('[AUTH] Signup Error:', error.message);
    next(error);
  }
};

// @desc    Authenticate user & get tokens
// @route   POST /api/auth/login
// @access  Public
const login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email or password format',
        errors: errors.array(),
      });
    }

    const { email, password, rememberMe } = req.body;

    const maskedEmail = email ? email.toLowerCase().replace(/(?<=^.{2}).+?(?=@)/, '***') : 'unknown';
    console.log(`[AUTH] Login attempt for email: ${maskedEmail}`);

    // Find user (include password for comparison)
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // If account was created via Google and has no password
    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: 'This account uses Google Sign-In. Please sign in with Google.',
      });
    }

    // Check password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Update online status
    user.isOnline = true;
    await user.save();

    // Generate tokens
    const accessToken = generateAccessToken(user._id);
    await generateRefreshToken(user._id, !!rememberMe, res);

    const userObj = user.toJSON();

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      accessToken,
      user: userObj,
    });
  } catch (error) {
    console.error('[AUTH] Login Error:', error.message);
    next(error);
  }
};

// @desc    Sign in / Sign up with Google OAuth 2.0
// @route   POST /api/auth/google
// @access  Public
const googleAuth = async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'Google ID Token is required',
      });
    }

    const googleUser = await verifyGoogleIdToken(idToken);
    const { email, name, picture } = googleUser;

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (!user.avatarUrl && picture) {
        user.avatarUrl = picture;
      }
      user.isOnline = true;
      await user.save();
    } else {
      user = await User.create({
        name: name || 'Google User',
        email: email.toLowerCase(),
        authProvider: 'google',
        avatarUrl: picture || '',
        isOnline: true,
      });
    }

    const accessToken = generateAccessToken(user._id);
    await generateRefreshToken(user._id, true, res);

    res.status(200).json({
      success: true,
      message: 'Google Authentication successful',
      accessToken,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Google auth controller error:', error.message);
    res.status(400).json({
      success: false,
      message: error.message || 'Google authentication failed',
    });
  }
};

// @desc    Refresh access token using httpOnly refreshToken cookie
// @route   POST /api/auth/refresh
// @access  Public (via cookie)
const refreshToken = async (req, res, next) => {
  try {
    const refreshTokenCookie = req.cookies.refreshToken;
    if (!refreshTokenCookie) {
      return res.status(401).json({
        success: false,
        message: 'No refresh token provided',
      });
    }

    const storedToken = await RefreshToken.findOne({ token: refreshTokenCookie });
    if (!storedToken) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or revoked refresh token',
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(
        refreshTokenCookie,
        process.env.JWT_REFRESH_SECRET || 'fallback_refresh_secret'
      );
    } catch (err) {
      await RefreshToken.deleteOne({ token: refreshTokenCookie });
      return res.status(401).json({
        success: false,
        message: 'Expired or invalid refresh token',
      });
    }

    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User no longer exists',
      });
    }

    const accessToken = generateAccessToken(user._id);

    res.status(200).json({
      success: true,
      accessToken,
      user: user.toJSON(),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Logout user (clear cookie & invalidate refresh token)
// @route   POST /api/auth/logout
// @access  Private
const logout = async (req, res, next) => {
  try {
    const refreshTokenCookie = req.cookies.refreshToken;
    if (refreshTokenCookie) {
      await RefreshToken.deleteOne({ token: refreshTokenCookie });
    }

    if (req.user) {
      await User.findByIdAndUpdate(req.user._id, {
        isOnline: false,
        lastSeen: new Date(),
      });
    }

    const isProduction = process.env.NODE_ENV === 'production' || !!process.env.VERCEL;
    res.clearCookie('refreshToken', {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax',
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Send password reset email
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(200).json({
        success: true,
        message: 'If an account exists with that email, a password reset link has been sent.',
      });
    }

    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: 'This account uses Google Sign-In. Password reset is not applicable.',
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1 hour
    await user.save();

    await sendPasswordResetEmail(user.email, resetToken, req.headers.host);

    res.status(200).json({
      success: true,
      message: 'If an account exists with that email, a password reset link has been sent.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Reset password using token
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res, next) => {
  try {
    const { token, newPassword, confirmNewPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token and new password are required',
      });
    }

    if (newPassword !== confirmNewPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 number, and 1 special character.',
      });
    }

    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired password reset token',
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Password reset successful. You can now log in with your new password.',
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  signup,
  login,
  googleAuth,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
};
