const fs = require('fs');
const path = require('path');

// Resolve the logo image that sits alongside the server (copied from the app).
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');

// Generate 6-digit OTP
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP email
async function sendOTPEmail(transporter, email, otp, fullName, isPasswordReset = false) {
  const mailOptions = isPasswordReset
    ? {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: 'Reset Your Kanti Password',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; padding: 24px 0 16px;">
              <img
                src="cid:kanti-logo"
                alt="Kanti"
                width="142"
                height="60"
                style="width: 142px; height: auto; display: block; margin: 0 auto;"
              />
            </div>
            <h2 style="color: #C1714F;">Password Reset Request</h2>
            <p>Hi ${fullName},</p>
            <p>We received a request to reset your password. Please use the following code to reset your password:</p>
            <div style="background-color: #FAF3EE; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
              <h1 style="color: #C1714F; letter-spacing: 8px; margin: 0;">${otp}</h1>
            </div>
            <p style="color: #6B6B6B;">This code will expire in 1 hour.</p>
            <p style="color: #6B6B6B;">If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
            <br>
            <p style="color: #1A1A1A;">Best regards,<br><strong>The Kanti Team</strong></p>
          </div>
        `,
      }
    : {
        from: process.env.EMAIL_FROM,
        to: email,
        subject: 'Verify Your Kanti Account',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="text-align: center; padding: 24px 0 16px;">
              <img
                src="cid:kanti-logo"
                alt="Kanti"
                width="142"
                height="60"
                style="width: 142px; height: auto; display: block; margin: 0 auto;"
              />
            </div>
            <h2 style="color: #C1714F;">Welcome to Kanti, ${fullName}!</h2>
            <p>Thank you for signing up. Please verify your email address by entering the following code:</p>
            <div style="background-color: #FAF3EE; padding: 20px; text-align: center; border-radius: 10px; margin: 20px 0;">
              <h1 style="color: #C1714F; letter-spacing: 8px; margin: 0;">${otp}</h1>
            </div>
            <p style="color: #6B6B6B;">This code will expire in 1 hour.</p>
            <p style="color: #6B6B6B;">If you didn't create an account, please ignore this email.</p>
            <br>
            <p style="color: #1A1A1A;">Best regards,<br><strong>The Kanti Team</strong></p>
          </div>
        `,
      };

  // Inline-attach the brand logo so it renders in the email without an external request.
  if (fs.existsSync(LOGO_PATH)) {
    mailOptions.attachments = [
      {
        filename: 'logo.png',
        path: LOGO_PATH,
        cid: 'kanti-logo',
      },
    ];
  } else {
    console.warn('⚠️  Logo not found at', LOGO_PATH, '- emails will render without the image logo.');
  }

  try {
    await transporter.sendMail(mailOptions);
    console.log(`✉️  ${isPasswordReset ? 'Password reset' : 'OTP'} email sent to ${email}`);
    return true;
  } catch (error) {
    console.error('❌ Error sending email:', error);
    return false;
  }
}

module.exports = { generateOTP, sendOTPEmail };
