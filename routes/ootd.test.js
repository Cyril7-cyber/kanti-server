const jwt = require("jsonwebtoken");

const mockGenerateOotdSuggestions = jest.fn();
class MockGeminiError extends Error {}
jest.mock("../utils/gemini", () => ({
  generateOotdSuggestions: mockGenerateOotdSuggestions,
  GeminiError: MockGeminiError,
}));

const express = require("express");
const request = require("supertest");
const ootdRoutes = require("./ootd");

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/ootd", ootdRoutes);
  return app;
}

const app = buildApp();
const validToken = jwt.sign({ userId: 1, email: "ada@example.com" }, process.env.JWT_SECRET);

function makeItem(id, category) {
  return { id, category, name: `${category} ${id}` };
}

const fullWardrobe = [
  makeItem("1", "Top"),
  makeItem("2", "Bottom"),
  makeItem("3", "Shoes"),
  makeItem("4", "Outerwear"),
  makeItem("5", "Accessories"),
];

const weather = { temperatureC: 15, condition: "Cloudy", location: "London" };

beforeEach(() => {
  mockGenerateOotdSuggestions.mockReset();
});

describe("POST /api/ootd/suggest", () => {
  it("rejects requests without a bearer token", async () => {
    const res = await request(app)
      .post("/api/ootd/suggest")
      .send({ items: fullWardrobe, weather });

    expect(res.status).toBe(401);
    expect(mockGenerateOotdSuggestions).not.toHaveBeenCalled();
  });

  it("rejects a missing items array", async () => {
    const res = await request(app)
      .post("/api/ootd/suggest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ weather });

    expect(res.status).toBe(400);
    expect(mockGenerateOotdSuggestions).not.toHaveBeenCalled();
  });

  it("rejects an invalid category on an item", async () => {
    const res = await request(app)
      .post("/api/ootd/suggest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ items: [...fullWardrobe, { id: "6", category: "Hat", name: "Hat" }], weather });

    expect(res.status).toBe(400);
    expect(mockGenerateOotdSuggestions).not.toHaveBeenCalled();
  });

  it("rejects missing weather", async () => {
    const res = await request(app)
      .post("/api/ootd/suggest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ items: fullWardrobe });

    expect(res.status).toBe(400);
    expect(mockGenerateOotdSuggestions).not.toHaveBeenCalled();
  });

  it("returns 422 when the wardrobe has fewer than 5 items", async () => {
    const res = await request(app)
      .post("/api/ootd/suggest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ items: fullWardrobe.slice(0, 4), weather });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("wardrobe_too_small");
    expect(mockGenerateOotdSuggestions).not.toHaveBeenCalled();
  });

  it("returns 422 when the wardrobe is missing a required category", async () => {
    const noShoes = [
      makeItem("1", "Top"),
      makeItem("2", "Bottom"),
      makeItem("3", "Outerwear"),
      makeItem("4", "Accessories"),
      makeItem("5", "Sweater"),
    ];

    const res = await request(app)
      .post("/api/ootd/suggest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ items: noShoes, weather });

    expect(res.status).toBe(422);
    expect(res.body.reason).toBe("missing_required_categories");
    expect(res.body.missingCategories).toEqual(["Shoes"]);
    expect(mockGenerateOotdSuggestions).not.toHaveBeenCalled();
  });

  it("returns the outfits Gemini produces for a valid request", async () => {
    mockGenerateOotdSuggestions.mockResolvedValue({
      outfits: [{ occasion: "Work", itemIds: ["1", "2", "3"], note: "Crisp and put-together." }],
    });

    const res = await request(app)
      .post("/api/ootd/suggest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ items: fullWardrobe, weather });

    expect(res.status).toBe(200);
    expect(res.body.outfits).toEqual([
      { occasion: "Work", itemIds: ["1", "2", "3"], note: "Crisp and put-together." },
    ]);
    expect(mockGenerateOotdSuggestions).toHaveBeenCalledWith({ items: fullWardrobe, weather });
  });

  it("returns 502 when Gemini fails", async () => {
    mockGenerateOotdSuggestions.mockRejectedValue(new MockGeminiError("boom"));

    const res = await request(app)
      .post("/api/ootd/suggest")
      .set("Authorization", `Bearer ${validToken}`)
      .send({ items: fullWardrobe, weather });

    expect(res.status).toBe(502);
  });
});
