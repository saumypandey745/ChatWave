const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { validationResult } = require('express-validator');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const RefreshToken = require('../models/RefreshToken');
const { generateAccessToken, generateRefreshToken } = require('../utils/generateTokens');
const { verifyGoogleIdToken } = require('../config/googleClient');
const { sendVerificationCodeEmail, sendResetOtpEmail } = require('../utils/sendEmail');

// @desc    Register a new user (Requires Email Verification)
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

    // Generate 6-digit verification code & hash it
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const codeExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Create user with isEmailVerified: false
    const newUser = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      authProvider: 'local',
      isEmailVerified: false,
      emailVerificationCodeHash: codeHash,
      emailVerificationCodeExpires: codeExpires,
    });

    // Send verification email via Nodemailer (SMTP)
    await sendVerificationCodeEmail(newUser.email, code);

    res.status(201).json({
      success: true,
      requiresVerification: true,
      email: newUser.email,
      message: 'Account created! Please check your email for the 6-digit verification code.',
    });
  } catch (error) {
    console.error('[AUTH] Signup Error:', error.message);
    next(error);
  }
};

// @desc    Verify signup email code
// @route   POST /api/auth/verify-email
// @access  Public
const verifyEmail = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      return res.status(400).json({
        success: false,
        message: 'Email and verification code are required',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+emailVerificationCodeHash +emailVerificationCodeExpires'
    );

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'User account not found',
      });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified. Please sign in.',
      });
    }

    if (
      !user.emailVerificationCodeHash ||
      !user.emailVerificationCodeExpires ||
      user.emailVerificationCodeExpires < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Verification code has expired. Please request a new code.',
      });
    }

    const isMatch = await bcrypt.compare(code, user.emailVerificationCodeHash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid verification code. Please check and try again.',
      });
    }

    // Mark verified & clear verification code fields
    user.isEmailVerified = true;
    user.emailVerificationCodeHash = undefined;
    user.emailVerificationCodeExpires = undefined;
    user.isOnline = true;
    await user.save();

    // Generate tokens & login automatically
    const accessToken = generateAccessToken(user._id);
    await generateRefreshToken(user._id, true, res);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      accessToken,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('[AUTH] Verify Email Error:', error.message);
    next(error);
  }
};

// @desc    Resend email verification code (Rate-limited to 3 requests per 15 mins)
// @route   POST /api/auth/resend-verification
// @access  Public
const resendVerification = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(400).json({ success: false, message: 'Account not found' });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        message: 'Email is already verified. Please sign in.',
      });
    }

    // Generate new code, hash it, set 10 min expiry
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = await bcrypt.hash(code, 10);

    user.emailVerificationCodeHash = codeHash;
    user.emailVerificationCodeExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    await sendVerificationCodeEmail(user.email, code);

    res.status(200).json({
      success: true,
      message: 'A new verification code has been sent to your email address.',
    });
  } catch (error) {
    console.error('[AUTH] Resend Verification Error:', error.message);
    next(error);
  }
};

// @desc    Authenticate user & get tokens (Blocks unverified accounts)
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

    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    if (user.authProvider === 'google' && !user.password) {
      return res.status(400).json({
        success: false,
        message: 'This account uses Google Sign-In. Please sign in with Google.',
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if email is verified
    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        isUnverified: true,
        email: user.email,
        message: 'Please verify your email address before logging in.',
      });
    }

    user.isOnline = true;
    await user.save();

    const accessToken = generateAccessToken(user._id);
    await generateRefreshToken(user._id, !!rememberMe, res);

    res.status(200).json({
      success: true,
      message: 'Logged in successfully',
      accessToken,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('[AUTH] Login Error:', error.message);
    console.error('[AUTH] Login Error stack:', error.stack);
    next(error);
  }
};

// @desc    Sign in / Sign up with Google OAuth 2.0 (Google users auto-verified)
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
      user.isEmailVerified = true; // Auto-verify Google user
      user.isOnline = true;
      await user.save();
    } else {
      user = await User.create({
        name: name || 'Google User',
        email: email.toLowerCase(),
        authProvider: 'google',
        avatarUrl: picture || '',
        isEmailVerified: true, // Google users bypass email verification
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

    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        isUnverified: true,
        message: 'Email address not verified',
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

// @desc    Send 6-digit OTP for Forgot Password (Rate-limited, prevents enumeration)
// @route   POST /api/auth/forgot-password
// @access  Public
const forgotPassword = async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const genericSuccessResponse = {
      success: true,
      message: 'If an account exists with that email, a 6-digit OTP has been sent to your inbox.',
    };

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || (user.authProvider === 'google' && !user.password)) {
      // Return generic success response to prevent user enumeration
      return res.status(200).json(genericSuccessResponse);
    }

    // Generate 6-digit OTP, hash it, set 10-minute expiry
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpires = new Date(Date.now() + 10 * 60 * 1000);

    user.resetOtpHash = otpHash;
    user.resetOtpExpires = otpExpires;
    await user.save();

    await sendResetOtpEmail(user.email, otp);

    res.status(200).json(genericSuccessResponse);
  } catch (error) {
    console.error('[AUTH] Forgot Password Error:', error.message);
    next(error);
  }
};

// @desc    Verify reset OTP and return single-use reset token
// @route   POST /api/auth/verify-reset-otp
// @access  Public
const verifyResetOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: 'Email and OTP are required',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() }).select(
      '+resetOtpHash +resetOtpExpires'
    );

    if (
      !user ||
      !user.resetOtpHash ||
      !user.resetOtpExpires ||
      user.resetOtpExpires < Date.now()
    ) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired OTP. Please request a new one.',
      });
    }

    const isMatch = await bcrypt.compare(otp, user.resetOtpHash);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: 'Invalid OTP. Please check and try again.',
      });
    }

    // Clear OTP fields & generate single-use 10-minute resetToken
    user.resetOtpHash = undefined;
    user.resetOtpExpires = undefined;

    const rawResetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = crypto.createHash('sha256').update(rawResetToken).digest('hex');

    user.resetPasswordToken = hashedResetToken;
    user.resetPasswordExpires = new Date(Date.now() + 10 * 60 * 1000);
    await user.save();

    res.status(200).json({
      success: true,
      message: 'OTP verified successfully',
      resetToken: rawResetToken,
    });
  } catch (error) {
    console.error('[AUTH] Verify Reset OTP Error:', error.message);
    next(error);
  }
};

// @desc    Reset password using single-use reset token & invalidate all sessions
// @route   POST /api/auth/reset-password
// @access  Public
const resetPassword = async (req, res, next) => {
  try {
    const { resetToken, newPassword, confirmNewPassword } = req.body;

    if (!resetToken || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Reset token and new password are required',
      });
    }

    if (confirmNewPassword !== undefined && newPassword !== confirmNewPassword) {
      return res.status(400).json({
        success: false,
        message: 'Passwords do not match',
      });
    }

    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return res.status(400).json({
        success: false,
        message:
          'Password must be at least 8 characters long and contain at least 1 uppercase letter, 1 number, and 1 special character.',
      });
    }

    const hashedToken = crypto.createHash('sha256').update(resetToken).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired reset token. Please request a new password reset.',
      });
    }

    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(newPassword, salt);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    // Invalidate ALL existing refresh tokens / sessions for this user across all devices!
    await RefreshToken.deleteMany({ userId: user._id });

    res.status(200).json({
      success: true,
      message: 'Password reset successful. All active sessions have been invalidated. Please log in with your new password.',
    });
  } catch (error) {
    console.error('[AUTH] Reset Password Error:', error.message);
    next(error);
  }
};

module.exports = {
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
};
