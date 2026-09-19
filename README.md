# Kanti Server

Node.js backend server for the Kanti React Native app with Supabase PostgreSQL integration.

## Setup Instructions

### 1. Database Setup

Go to your Supabase SQL Editor and run this SQL:

```sql
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT,
  display_picture_url TEXT DEFAULT '',
  verified BOOLEAN DEFAULT false,
  provider TEXT DEFAULT 'email',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);
```

### 2. Email Setup (Gmail)

1. Go to your Google Account settings
2. Enable 2-Factor Authentication
3. Generate an App Password: https://support.google.com/accounts/answer/185833
4. Update `.env` with your Gmail and App Password

### 3. Environment Variables

Update the `.env` file with your email credentials:

```
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-password
```

### 4. Install & Run

```bash
npm install
npm start
```

For development with auto-reload:
```bash
npm install -g nodemon
npm run dev
```

## API Endpoints

### POST `/api/auth/register`
Register a new user and send OTP email.

**Body:**
```json
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": "Registration successful. Please check your email for verification code.",
  "userId": "uuid",
  "email": "john@example.com"
}
```

### POST `/api/auth/verify-otp`
Verify email with OTP code.

**Body:**
```json
{
  "email": "john@example.com",
  "otp": "123456"
}
```

**Response:**
```json
{
  "message": "Email verified successfully",
  "token": "jwt-token",
  "user": {
    "_id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "displayPictureUrl": "",
    "verified": true
  }
}
```

### POST `/api/auth/resend-otp`
Resend OTP code to email.

**Body:**
```json
{
  "email": "john@example.com"
}
```

### POST `/api/auth/login`
Login with email and password.

**Body:**
```json
{
  "email": "john@example.com",
  "password": "password123"
}
```

**Response:**
```json
{
  "message": "Login successful",
  "token": "jwt-token",
  "user": {
    "_id": "uuid",
    "name": "John Doe",
    "email": "john@example.com",
    "displayPictureUrl": "",
    "verified": true
  }
}
```

## Security Features

- ✅ Bcrypt password hashing
- ✅ JWT token authentication
- ✅ Email verification with OTP
- ✅ OTP expiration (1 hour)
- ✅ CORS enabled
- ✅ Input validation

## Notes

- OTP codes are 6 digits
- OTP codes expire after 1 hour
- Users must verify email before logging in
- Unverified users can re-register with the same email
