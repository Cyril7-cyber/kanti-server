// Shared OTP persistence/validation logic used by every OTP-issuing and
// OTP-consuming route, so the "delete old codes before saving a new one" and
// "delete on expiry" rules live in exactly one place.

// Deletes any existing OTP rows for this email, then inserts the new one.
// Returns the inserted row so callers can confirm the save succeeded before
// sending the OTP email.
async function saveOTP(supabase, table, { userId, email, otp, expiresAt }) {
  const { error: deleteError } = await supabase
    .from(table)
    .delete()
    .eq("email", email);

  if (deleteError) {
    return { data: null, error: deleteError };
  }

  const { data, error } = await supabase
    .from(table)
    .insert([
      {
        user_id: userId,
        email,
        otp,
        expires_at: expiresAt,
      },
    ])
    .select()
    .single();

  return { data, error };
}

// Looks up the most recent OTP row matching email+otp, regardless of
// expiry. If it's expired, deletes it and reports that instead of treating
// it the same as "wrong code". Does NOT delete a still-valid row — the
// caller is responsible for deleting it once it's been consumed.
async function consumeOTP(supabase, table, { email, otp }) {
  const { data: record, error } = await supabase
    .from(table)
    .select("*")
    .eq("email", email)
    .eq("otp", otp)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !record) {
    return { status: "not_found" };
  }

  if (new Date(record.expires_at) <= new Date()) {
    await supabase.from(table).delete().eq("id", record.id);
    return { status: "expired" };
  }

  return { status: "valid", record };
}

module.exports = { saveOTP, consumeOTP };
