const { createMockSupabase } = require("../test-utils/mockSupabase");

const mockSupabase = createMockSupabase();
jest.mock("../config/database", () => mockSupabase);
jest.mock("../config/email", () => ({ __esModule: true, default: {} }));

const mockGenerateOTP = jest.fn(() => "654321");
const mockSendOTPEmail = jest.fn(() => Promise.resolve(true));
jest.mock("../utils/email", () => ({
  generateOTP: mockGenerateOTP,
  sendOTPEmail: mockSendOTPEmail,
}));

const express = require("express");
const request = require("supertest");
const authRoutes = require("./auth");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", authRoutes);
  return app;
}

const app = buildApp();

beforeEach(() => {
  mockSupabase.__reset();
  mockGenerateOTP.mockClear().mockReturnValue("654321");
  mockSendOTPEmail.mockClear().mockResolvedValue(true);
});

describe("POST /api/auth/register", () => {
  const body = { name: "Ada Lovelace", email: "Ada@Example.com", password: "Passw0rd!" };

  it("saves the OTP (delete-then-insert) and only emails it after the save succeeds", async () => {
    mockSupabase.mockResult("users", { data: null, error: { message: "not found" } }); // existing user check
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com" },
      error: null,
    }); // insert new user
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // delete old codes
    mockSupabase.mockResult("otp_codes", { data: { id: "otp-1" }, error: null }); // insert new code

    const res = await request(app).post("/api/auth/register").send(body);

    expect(res.status).toBe(201);
    expect(mockSendOTPEmail).toHaveBeenCalledTimes(1);
    expect(mockSendOTPEmail).toHaveBeenCalledWith(
      expect.anything(),
      "ada@example.com",
      "654321",
      "Ada Lovelace",
    );
  });

  it("does not send an email if saving the OTP fails", async () => {
    mockSupabase.mockResult("users", { data: null, error: { message: "not found" } });
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com" },
      error: null,
    });
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // delete
    mockSupabase.mockResult("otp_codes", { data: null, error: { message: "insert failed" } }); // insert fails

    const res = await request(app).post("/api/auth/register").send(body);

    expect(res.status).toBe(500);
    expect(mockSendOTPEmail).not.toHaveBeenCalled();
  });

  it("rejects a password without a number", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ ...body, password: "Password!" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/number/i);
  });
});

describe("POST /api/auth/verify-otp", () => {
  it("verifies, deletes the OTP, and returns a token for a valid code", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockSupabase.mockResult("otp_codes", {
      data: { id: "otp-1", user_id: 1, expires_at: futureExpiry },
      error: null,
    }); // consumeOTP select
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com", full_name: "Ada Lovelace", verified: false },
      error: null,
    }); // get user
    mockSupabase.mockResult("users", { data: null, error: null }); // mark verified
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // delete used OTP

    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: "ada@example.com", otp: "654321" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    expect(res.body.user.email).toBe("ada@example.com");
  });

  it("deletes an expired OTP and reports it as expired rather than just invalid", async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    mockSupabase.mockResult("otp_codes", {
      data: { id: "otp-1", user_id: 1, expires_at: pastExpiry },
      error: null,
    }); // consumeOTP select finds the expired row
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // consumeOTP's own delete

    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: "ada@example.com", otp: "654321" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
    // select + delete, and nothing more (no user lookup/update for a dead code)
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
  });

  it("returns a generic invalid message when no OTP row matches at all", async () => {
    mockSupabase.mockResult("otp_codes", { data: null, error: { message: "no rows" } });

    const res = await request(app)
      .post("/api/auth/verify-otp")
      .send({ email: "ada@example.com", otp: "000000" });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid/i);
    expect(res.body.message).not.toMatch(/expired/i);
  });
});

describe("POST /api/auth/resend-otp", () => {
  it("deletes the old code before saving the new one, then emails it", async () => {
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com", full_name: "Ada Lovelace", verified: false },
      error: null,
    });
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // delete
    mockSupabase.mockResult("otp_codes", { data: { id: "otp-2" }, error: null }); // insert

    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: "ada@example.com" });

    expect(res.status).toBe(200);
    expect(mockSendOTPEmail).toHaveBeenCalledTimes(1);
  });

  it("reports failure if the email can't be sent, even though the OTP was saved", async () => {
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com", full_name: "Ada Lovelace", verified: false },
      error: null,
    });
    mockSupabase.mockResult("otp_codes", { data: null, error: null });
    mockSupabase.mockResult("otp_codes", { data: { id: "otp-2" }, error: null });
    mockSendOTPEmail.mockResolvedValueOnce(false);

    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: "ada@example.com" });

    expect(res.status).toBe(500);
  });

  it("refuses to resend for an already-verified email", async () => {
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com", verified: true },
      error: null,
    });

    const res = await request(app)
      .post("/api/auth/resend-otp")
      .send({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(mockSendOTPEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/forgot-password", () => {
  it("only issues a reset code for a verified user, saved into otp_codes", async () => {
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com", full_name: "Ada Lovelace", verified: true },
      error: null,
    });
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // delete
    mockSupabase.mockResult("otp_codes", { data: { id: "otp-3" }, error: null }); // insert

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ada@example.com" });

    expect(res.status).toBe(200);
    expect(mockSupabase.from).toHaveBeenNthCalledWith(2, "otp_codes");
    expect(mockSupabase.from).toHaveBeenNthCalledWith(3, "otp_codes");
  });

  it("refuses an unverified account", async () => {
    mockSupabase.mockResult("users", {
      data: { id: 1, email: "ada@example.com", verified: false },
      error: null,
    });

    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "ada@example.com" });

    expect(res.status).toBe(400);
    expect(mockSendOTPEmail).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/verify-reset-otp", () => {
  it("accepts a valid code belonging to a verified user", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockSupabase.mockResult("otp_codes", {
      data: { id: "otp-1", user_id: 1, expires_at: futureExpiry },
      error: null,
    });
    mockSupabase.mockResult("users", { data: { verified: true }, error: null });

    const res = await request(app)
      .post("/api/auth/verify-reset-otp")
      .send({ email: "ada@example.com", otp: "654321" });

    expect(res.status).toBe(200);
    expect(res.body.verified).toBe(true);
  });

  it("rejects a code that belongs to an unverified account (shared otp_codes table)", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockSupabase.mockResult("otp_codes", {
      data: { id: "otp-1", user_id: 2, expires_at: futureExpiry },
      error: null,
    });
    mockSupabase.mockResult("users", { data: { verified: false }, error: null });

    const res = await request(app)
      .post("/api/auth/verify-reset-otp")
      .send({ email: "unverified@example.com", otp: "654321" });

    expect(res.status).toBe(400);
  });
});

describe("POST /api/auth/reset-password", () => {
  const newPasswordBody = {
    email: "ada@example.com",
    otp: "654321",
    newPassword: "NewPassw0rd!",
  };

  it("resets the password for a verified user and deletes the used OTP", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockSupabase.mockResult("otp_codes", {
      data: { id: "otp-1", user_id: 1, expires_at: futureExpiry },
      error: null,
    }); // consumeOTP select
    mockSupabase.mockResult("users", {
      data: { id: 1, verified: true },
      error: null,
    }); // get user
    mockSupabase.mockResult("users", { data: null, error: null }); // update password
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // delete used OTP

    const res = await request(app).post("/api/auth/reset-password").send(newPasswordBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("refuses to reset the password for an unverified account", async () => {
    const futureExpiry = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockSupabase.mockResult("otp_codes", {
      data: { id: "otp-1", user_id: 2, expires_at: futureExpiry },
      error: null,
    });
    mockSupabase.mockResult("users", { data: { id: 2, verified: false }, error: null });

    const res = await request(app).post("/api/auth/reset-password").send(newPasswordBody);

    expect(res.status).toBe(400);
    // Only the OTP select + the user lookup — no password update should run.
    expect(mockSupabase.from).toHaveBeenCalledTimes(2);
  });

  it("deletes an expired reset OTP and reports it as expired", async () => {
    const pastExpiry = new Date(Date.now() - 1000).toISOString();
    mockSupabase.mockResult("otp_codes", {
      data: { id: "otp-1", user_id: 1, expires_at: pastExpiry },
      error: null,
    });
    mockSupabase.mockResult("otp_codes", { data: null, error: null }); // consumeOTP's delete

    const res = await request(app).post("/api/auth/reset-password").send(newPasswordBody);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });
});
