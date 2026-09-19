// Hermetic env for tests — deliberately not loading the real .env, so tests
// never depend on (or risk touching) real Supabase/email credentials.
process.env.JWT_SECRET = "test-jwt-secret";
