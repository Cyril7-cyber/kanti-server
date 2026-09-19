const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/database');
const transporter = require('../config/email');
const { generateOTP, sendOTPEmail } = require('../utils/email');
const { saveOTP, consumeOTP } = require('../utils/otp');

// Register endpoint
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;

    // Validation
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    if (name.trim().length < 2) {
      return res.status(400).json({ message: 'Name must be at least 2 characters long' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    // Password validation
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    if (!/\d/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one number' });
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      return res.status(400).json({ message: 'Password must contain at least one special character' });
    }

    const emailLower = email.toLowerCase().trim();

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, verified')
      .eq('email', emailLower)
      .single();

    if (existingUser) {
      if (existingUser.verified) {
        return res.status(400).json({ message: 'Email already registered' });
      } else {
        // User exists but not verified, allow re-registration
        await supabase.from('users').delete().eq('id', existingUser.id);
      }
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([
        {
          full_name: name.trim(),
          email: emailLower,
          password: hashedPassword,
          display_picture_url: '',
          verified: false,
          provider: 'email',
        },
      ])
      .select()
      .single();

    if (userError) {
      console.error('User creation error:', userError);
      return res.status(500).json({ message: 'Failed to create user' });
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour from now

    // Save OTP (deletes any existing codes for this email first)
    const { error: otpError } = await saveOTP(supabase, 'otp_codes', {
      userId: newUser.id,
      email: emailLower,
      otp,
      expiresAt: expiresAt.toISOString(),
    });

    if (otpError) {
      console.error('OTP creation error:', otpError);
      return res.status(500).json({ message: 'Failed to generate verification code' });
    }

    // Only send the email once the OTP is confirmed saved
    const emailSent = await sendOTPEmail(transporter, emailLower, otp, name.trim());
    if (!emailSent) {
      console.warn('⚠️  Email sending failed, but user was created');
    }

    res.status(201).json({
      message: 'Registration successful. Please check your email for verification code.',
      userId: newUser.id,
      email: emailLower,
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify OTP endpoint
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const emailLower = email.toLowerCase().trim();

    // Find OTP (deletes it automatically if it's expired)
    const otpResult = await consumeOTP(supabase, 'otp_codes', { email: emailLower, otp });

    if (otpResult.status === 'expired') {
      return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
    }

    if (otpResult.status === 'not_found') {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    const otpRecord = otpResult.record;

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', otpRecord.user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Mark user as verified
    const { error: updateError } = await supabase
      .from('users')
      .update({ verified: true, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (updateError) {
      return res.status(500).json({ message: 'Failed to verify user' });
    }

    // Delete used OTP
    await supabase.from('otp_codes').delete().eq('id', otpRecord.id);

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Email verified successfully',
      token,
      user: {
        _id: user.id,
        name: user.full_name,
        email: user.email,
        displayPictureUrl: user.display_picture_url,
        verified: true,
      },
    });
  } catch (error) {
    console.error('Verify OTP error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Resend OTP endpoint
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    const emailLower = email.toLowerCase().trim();

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', emailLower)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.verified) {
      return res.status(400).json({ message: 'Email already verified' });
    }

    // Generate new OTP (saveOTP deletes old codes for this email first)
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const { error: otpError } = await saveOTP(supabase, 'otp_codes', {
      userId: user.id,
      email: emailLower,
      otp,
      expiresAt: expiresAt.toISOString(),
    });

    if (otpError) {
      return res.status(500).json({ message: 'Failed to generate verification code' });
    }

    // Only send the email once the OTP is confirmed saved
    const emailSent = await sendOTPEmail(transporter, emailLower, otp, user.full_name);
    if (!emailSent) {
      return res.status(500).json({ message: 'Failed to send verification email' });
    }

    res.json({ message: 'Verification code sent to your email' });
  } catch (error) {
    console.error('Resend OTP error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login endpoint
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    const emailLower = email.toLowerCase().trim();

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', emailLower)
      .single();

    if (userError || !user) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Check if user is verified
    if (!user.verified) {
      // Generate and send a fresh verification code so the user can
      // complete verification right away.
      const otp = generateOTP();
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

      // Save the new OTP (deletes any prior codes for this email first)
      const { error: otpError } = await saveOTP(supabase, 'otp_codes', {
        userId: user.id,
        email: emailLower,
        otp,
        expiresAt: expiresAt.toISOString(),
      });

      if (otpError) {
        console.error('OTP creation error:', otpError);
        return res.status(500).json({ message: 'Failed to generate verification code' });
      }

      // Only send the email once the OTP is confirmed saved
      const emailSent = await sendOTPEmail(transporter, emailLower, otp, user.full_name);
      if (!emailSent) {
        console.warn('⚠️  Verification email failed to send for unverified login');
      }

      return res.status(403).json({
        message: 'Please verify your email first',
        requiresVerification: true,
        email: emailLower
      });
    }

    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.json({
      message: 'Login successful',
      token,
      user: {
        _id: user.id,
        name: user.full_name,
        email: user.email,
        displayPictureUrl: user.display_picture_url,
        verified: user.verified,
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Forgot Password - Send OTP endpoint
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: 'Email is required' });
    }

    // Email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({ message: 'Please enter a valid email address' });
    }

    const emailLower = email.toLowerCase().trim();

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', emailLower)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'No account found with this email' });
    }

    if (!user.verified) {
      return res.status(400).json({ message: 'Please verify your email first' });
    }

    // Generate new OTP and save it in otp_codes (shared with registration/
    // login verification codes — safe because this branch is only reached
    // for already-verified users, who never have a pending OTP of their own)
    // (saveOTP deletes any existing codes for this email first)
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    const { error: otpError } = await saveOTP(supabase, 'otp_codes', {
      userId: user.id,
      email: emailLower,
      otp,
      expiresAt: expiresAt.toISOString(),
    });

    if (otpError) {
      console.error('Password reset OTP creation error:', otpError);
      return res.status(500).json({ message: 'Failed to generate verification code' });
    }

    // Only send the email once the OTP is confirmed saved
    const emailSent = await sendOTPEmail(transporter, emailLower, otp, user.full_name, true);
    if (!emailSent) {
      console.warn('⚠️  Email sending failed');
      return res.status(500).json({ message: 'Failed to send verification email' });
    }

    res.json({
      message: 'Password reset code sent to your email',
      email: emailLower,
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Verify Reset OTP endpoint
router.post('/verify-reset-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({ message: 'Email and OTP are required' });
    }

    const emailLower = email.toLowerCase().trim();

    // Find OTP (deletes it automatically if it's expired)
    const otpResult = await consumeOTP(supabase, 'otp_codes', { email: emailLower, otp });

    if (otpResult.status === 'expired') {
      return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
    }

    if (otpResult.status === 'not_found') {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // otp_codes is shared with the registration/login verification flow, so
    // make sure this code actually belongs to a password-reset request and
    // not, say, an unverified account's still-pending signup code.
    const { data: reqUser, error: reqUserError } = await supabase
      .from('users')
      .select('verified')
      .eq('id', otpResult.record.user_id)
      .single();

    if (reqUserError || !reqUser || !reqUser.verified) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    res.json({
      message: 'OTP verified successfully',
      verified: true,
    });
  } catch (error) {
    console.error('Verify reset OTP error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Reset Password endpoint
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ message: 'Email, OTP, and new password are required' });
    }

    // Password validation
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters long' });
    }

    if (!/\d/.test(newPassword)) {
      return res.status(400).json({ message: 'Password must contain at least one number' });
    }

    if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
      return res.status(400).json({ message: 'Password must contain at least one special character' });
    }

    const emailLower = email.toLowerCase().trim();

    // Find OTP (deletes it automatically if it's expired)
    const otpResult = await consumeOTP(supabase, 'otp_codes', { email: emailLower, otp });

    if (otpResult.status === 'expired') {
      return res.status(400).json({ message: 'This code has expired. Please request a new one.' });
    }

    if (otpResult.status === 'not_found') {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    const otpRecord = otpResult.record;

    // Get user
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', otpRecord.user_id)
      .single();

    if (userError || !user) {
      return res.status(404).json({ message: 'User not found' });
    }

    // otp_codes is shared with the registration/login verification flow —
    // only a verified account is allowed to reset its password this way, so
    // an unverified account's signup code can't be reused to set a password.
    if (!user.verified) {
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    const { error: updateError } = await supabase
      .from('users')
      .update({
        password: hashedPassword,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);

    if (updateError) {
      console.error('Password update error:', updateError);
      return res.status(500).json({ message: 'Failed to reset password' });
    }

    // Delete used OTP
    await supabase
      .from('otp_codes')
      .delete()
      .eq('id', otpRecord.id);

    res.json({
      message: 'Password reset successfully',
      success: true,
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

module.exports = router;
