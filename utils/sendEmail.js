const nodemailer = require('nodemailer');

const createTransporter = () => {
  const user = (process.env.SMTP_USER || '').trim();
  // Gmail App Passwords may have spaces in them (e.g. "abcd efgh ijkl mnop") — strip them
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '');

  if (!user || !pass) {
    console.error('❌ [EMAIL ERROR] SMTP_USER or SMTP_PASS environment variable is not configured.');
  }

  // Use service: 'gmail' for maximum cloud host compatibility & SSL reliability
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
};

const sendVerificationCodeEmail = async (email, code) => {
  try {
    const transporter = createTransporter();
    const fromAddress =
      process.env.SMTP_FROM || `"ChatWave" <${process.env.SMTP_USER || 'no-reply@chatwave.com'}>`;

    const mailOptions = {
      from: fromAddress,
      to: email,
      subject: 'ChatWave - Email Verification Code',
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4f46e5; font-size: 26px; font-weight: 800; margin: 0;">ChatWave</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Email Verification</p>
          </div>
          <div style="padding: 20px; background-color: #f8fafc; border-radius: 12px; text-align: center; margin-bottom: 24px;">
            <p style="color: #334155; font-size: 14px; margin: 0 0 12px 0;">Use the following verification code to complete your signup:</p>
            <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #4f46e5; background-color: #e0e7ff; padding: 12px 24px; border-radius: 8px; display: inline-block; font-family: monospace;">${code}</div>
            <p style="color: #64748b; font-size: 12px; margin: 12px 0 0 0;">This code is valid for <strong>10 minutes</strong> and can only be used once.</p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">If you did not request this code, you can safely ignore this email.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Verification code email sent to ${email} (MessageID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error(`[EMAIL ERROR] Failed to send verification code to ${email}:`, error.message);
    throw error; // Re-throw so the controller can handle the failure
  }
};

const sendResetOtpEmail = async (email, otp) => {
  try {
    const transporter = createTransporter();
    const fromAddress =
      process.env.SMTP_FROM || `"ChatWave" <${process.env.SMTP_USER || 'no-reply@chatwave.com'}>`;

    const mailOptions = {
      from: fromAddress,
      to: email,
      subject: 'ChatWave - Password Reset OTP',
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px;">
          <div style="text-align: center; margin-bottom: 24px;">
            <h1 style="color: #4f46e5; font-size: 26px; font-weight: 800; margin: 0;">ChatWave</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Password Reset Request</p>
          </div>
          <div style="padding: 20px; background-color: #f8fafc; border-radius: 12px; text-align: center; margin-bottom: 24px;">
            <p style="color: #334155; font-size: 14px; margin: 0 0 12px 0;">Use the following OTP code to reset your password:</p>
            <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #dc2626; background-color: #fee2e2; padding: 12px 24px; border-radius: 8px; display: inline-block; font-family: monospace;">${otp}</div>
            <p style="color: #64748b; font-size: 12px; margin: 12px 0 0 0;">This OTP is valid for <strong>10 minutes</strong> and can only be used once.</p>
          </div>
          <p style="color: #94a3b8; font-size: 12px; text-align: center; margin: 0;">If you did not request a password reset, please ignore this email.</p>
        </div>
      `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[EMAIL] Password reset OTP email sent to ${email} (MessageID: ${info.messageId})`);
    return info;
  } catch (error) {
    console.error(`[EMAIL ERROR] Failed to send password reset OTP to ${email}:`, error.message);
    throw error; // Re-throw so the controller can handle the failure
  }
};

module.exports = {
  sendVerificationCodeEmail,
  sendResetOtpEmail,
};
