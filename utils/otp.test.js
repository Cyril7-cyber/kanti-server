const { createMockSupabase } = require("../test-utils/mockSupabase");
const { saveOTP, consumeOTP } = require("./otp");

describe("saveOTP", () => {
  it("deletes existing rows for the email before inserting the new one", async () => {
    const supabase = createMockSupabase();
    supabase.mockResult("otp_codes", { data: null, error: null }); // delete
    supabase.mockResult("otp_codes", {
      data: { id: "row-1", user_id: 1, email: "a@b.com", otp: "111111" },
      error: null,
    }); // insert

    const result = await saveOTP(supabase, "otp_codes", {
      userId: 1,
      email: "a@b.com",
      otp: "111111",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(supabase.from).toHaveBeenNthCalledWith(1, "otp_codes");
    expect(supabase.from).toHaveBeenNthCalledWith(2, "otp_codes");
    expect(result.error).toBeNull();
    expect(result.data.id).toBe("row-1");
  });

  it("does not attempt the insert if the delete fails", async () => {
    const supabase = createMockSupabase();
    const deleteError = { message: "delete failed" };
    supabase.mockResult("otp_codes", { data: null, error: deleteError });

    const result = await saveOTP(supabase, "otp_codes", {
      userId: 1,
      email: "a@b.com",
      otp: "111111",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    // Only the delete call should have consumed a queued result — if the
    // insert had also run it would throw for a missing queued result.
    expect(supabase.from).toHaveBeenCalledTimes(1);
    expect(result.data).toBeNull();
    expect(result.error).toBe(deleteError);
  });

  it("surfaces an insert error", async () => {
    const supabase = createMockSupabase();
    const insertError = { message: "insert failed" };
    supabase.mockResult("otp_codes", { data: null, error: null }); // delete
    supabase.mockResult("otp_codes", { data: null, error: insertError }); // insert

    const result = await saveOTP(supabase, "otp_codes", {
      userId: 1,
      email: "a@b.com",
      otp: "111111",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });

    expect(result.error).toBe(insertError);
  });
});

describe("consumeOTP", () => {
  it("returns not_found when no row matches", async () => {
    const supabase = createMockSupabase();
    supabase.mockResult("otp_codes", { data: null, error: { message: "no rows" } });

    const result = await consumeOTP(supabase, "otp_codes", {
      email: "a@b.com",
      otp: "111111",
    });

    expect(result.status).toBe("not_found");
    // Only the select should have run — no delete for a code that doesn't exist.
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });

  it("deletes the row and returns expired when past expires_at", async () => {
    const supabase = createMockSupabase();
    const expiredRecord = {
      id: "row-1",
      user_id: 1,
      email: "a@b.com",
      otp: "111111",
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };
    supabase.mockResult("otp_codes", { data: expiredRecord, error: null }); // select
    supabase.mockResult("otp_codes", { data: null, error: null }); // delete

    const result = await consumeOTP(supabase, "otp_codes", {
      email: "a@b.com",
      otp: "111111",
    });

    expect(result.status).toBe("expired");
    expect(supabase.from).toHaveBeenCalledTimes(2);
  });

  it("returns valid without deleting when the row hasn't expired", async () => {
    const validRecord = {
      id: "row-1",
      user_id: 1,
      email: "a@b.com",
      otp: "111111",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
    const supabase = createMockSupabase();
    supabase.mockResult("otp_codes", { data: validRecord, error: null }); // select only

    const result = await consumeOTP(supabase, "otp_codes", {
      email: "a@b.com",
      otp: "111111",
    });

    expect(result.status).toBe("valid");
    expect(result.record).toBe(validRecord);
    // Only the select — the caller decides whether/when to delete a valid row.
    expect(supabase.from).toHaveBeenCalledTimes(1);
  });
});
