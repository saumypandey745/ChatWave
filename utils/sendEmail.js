const nodemailer = require('nodemailer');

const sendPasswordResetEmail = async (email, resetToken, host) => {
  const resetUrl = `${process.env.CLIENT_URL || 'http://localhost:5173'}/reset-password?token=${resetToken}`;
  
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.ethereal.email',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || '"ChatWave Support" <no-reply@chatwave.com>',
    to: email,
    subject: 'ChatWave - Password Reset Request',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 8px;">
        <h2 style="color: #6366f1; text-align: center;">ChatWave Password Reset</h2>
        <p>You requested a password reset for your ChatWave account.</p>
        <p>Click the button below to reset your password. This link is valid for 1 hour.</p>
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" style="background-color: #6366f1; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Reset Password</a>
        </div>
        <p style="color: #666; font-size: 12px;">If you did not request this, please ignore this email.</p>
        <p style="color: #666; font-size: 12px;">Direct link: <a href="${resetUrl}">${resetUrl}</a></p>
      </div>
    `,
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`Password reset email sent: ${info.messageId}`);
    return true;
  } catch (error) {
    console.warn(`Could not send email via SMTP (${error.message}). Logging reset link for testing:`);
    console.log(`=======================================================`);
    console.log(`PASSWORD RESET LINK FOR ${email}:`);
    console.log(resetUrl);
    console.log(`=======================================================`);
    return true;
  }
};

module.exports = {
  sendPasswordResetEmail,
};
