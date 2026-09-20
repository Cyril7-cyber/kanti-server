const jwt = require("jsonwebtoken");

const mockAnalyzeClothingImage = jest.fn();
class MockGeminiError extends Error {}
jest.mock("../utils/gemini", () => ({
  analyzeClothingImage: mockAnalyzeClothingImage,
  GeminiError: MockGeminiError,
}));

const express = require("express");
const request = require("supertest");
const wardrobeRoutes = require("./wardrobe");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/wardrobe", wardrobeRoutes);
  return app;
}

const app = buildApp();
const validToken = jwt.sign({ userId: 1, email: "ada@example.com" }, process.env.JWT_SECRET);

beforeEach(() => {
  mockAnalyzeClothingImage.mockReset();
});

describe("POST /api/wardrobe/analyze", () => {
  const body = { image: "base64data", mimeType: "image/jpeg" };

  it("rejects requests without a bearer token", async () => {
    const res = await request(app).post("/api/wardrobe/analyze").send(body);

    expect(res.status).toBe(401);
    expect(mockAnalyzeClothingImage).not.toHaveBeenCalled();
  });

  it("rejects a missing image", async () => {
    const res = await request(app)
      .post("/api/wardrobe/analyze")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ mimeType: "image/jpeg" });

    expect(res.status).toBe(400);
    expect(mockAnalyzeClothingImage).not.toHaveBeenCalled();
  });

  it("rejects an unsupported mime type", async () => {
    const res = await request(app)
      .post("/api/wardrobe/analyze")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ image: "base64data", mimeType: "image/gif" });

    expect(res.status).toBe(400);
    expect(mockAnalyzeClothingImage).not.toHaveBeenCalled();
  });

  it("returns the insights Gemini produces for a valid request", async () => {
    mockAnalyzeClothingImage.mockResolvedValue({
      colors: ["Navy"],
      pattern: "Solid",
      fabricType: "Cotton",
    });

    const res = await request(app)
      .post("/api/wardrobe/analyze")
      .set("Authorization", `Bearer ${validToken}`)
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ colors: ["Navy"], pattern: "Solid", fabricType: "Cotton" });
    expect(mockAnalyzeClothingImage).toHaveBeenCalledWith("base64data", "image/jpeg");
  });

  it("returns 502 when Gemini fails", async () => {
    mockAnalyzeClothingImage.mockRejectedValue(new MockGeminiError("boom"));

    const res = await request(app)
      .post("/api/wardrobe/analyze")
      .set("Authorization", `Bearer ${validToken}`)
      .send(body);

    expect(res.status).toBe(502);
  });
});
