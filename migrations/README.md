# Database Migration Instructions

## Password Reset OTP

The forgot-password flow reuses the existing `otp_codes` table (the same one
used for registration/login verification codes) — no separate table or
migration is needed. `routes/auth.js` guards against cross-flow reuse by only
issuing/accepting reset codes for already-verified users.

## New API Endpoints

The following endpoints have been added to the server:

1. **POST** `/api/auth/forgot-password` - Send OTP to email
2. **POST** `/api/auth/verify-reset-otp` - Verify the OTP code
3. **POST** `/api/auth/reset-password` - Reset password with OTP

## Testing the Feature

1. Start the server: `node index.js`
2. In the React Native app, navigate to Login screen
3. Click "Forgot Password?"
4. Enter your email and follow the flow
5. Check your email for the 6-digit OTP code
6. Enter the code and set a new password

## Notes

- OTP codes expire after 1 hour
- Users can resend OTP after 60 seconds (countdown timer)
- Only verified users can reset their password
- Old OTP codes are automatically deleted when a new one is requested
