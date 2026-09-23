const express = require("express");
const authenticate = require("../middleware/authenticate");
const { generateOotdSuggestions, GeminiError } = require("../utils/gemini");

const router = express.Router();

// Wardrobe photos live only on-device, so the client sends the lightweight
// metadata for each item (category, colors, pattern, fabric, fit) instead of
// images. Keep this in sync with db/schema.ts on the client.
const CATEGORIES = [
  "Top",
  "Bottom",
  "Dress",
  "Outerwear",
  "Shoes",
  "Accessories",
  "Sweater",
  "Carry-on",
];

// Mirrors the app's own eligibility rule: an OOTD needs enough pieces, and
// specifically a top, a bottom and shoes, to build a complete outfit.
const MIN_WARDROBE_SIZE = 5;
const REQUIRED_CATEGORIES = ["Top", "Bottom", "Shoes"];

function validateItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "items (non-empty array) is required";
  }
  if (items.length > 200) {
    return "items exceeds the maximum wardrobe size accepted per request";
  }

  for (const item of items) {
    if (!item || typeof item !== "object") {
      return "each item must be an object";
    }
    if (typeof item.id !== "string" || !item.id) {
      return "each item requires a non-empty string id";
    }
    if (!CATEGORIES.includes(item.category)) {
      return `each item requires a valid category (one of: ${CATEGORIES.join(", ")})`;
    }
    if (typeof item.name !== "string" || !item.name) {
      return "each item requires a non-empty string name";
    }
  }

  return null;
}

function validateWeather(weather) {
  if (!weather || typeof weather !== "object") {
    return "weather is required";
  }
  if (typeof weather.temperatureC !== "number" || Number.isNaN(weather.temperatureC)) {
    return "weather.temperatureC (number) is required";
  }
  if (typeof weather.condition !== "string" || !weather.condition) {
    return "weather.condition (string) is required";
  }
  return null;
}

function missingRequiredCategories(items) {
  const present = new Set(items.map((item) => item.category));
  return REQUIRED_CATEGORIES.filter((category) => !present.has(category));
}

router.post("/suggest", authenticate, async (req, res) => {
  const { items, weather } = req.body;

  const itemsError = validateItems(items);
  if (itemsError) {
    return res.status(400).json({ message: itemsError });
  }

  const weatherError = validateWeather(weather);
  if (weatherError) {
    return res.status(400).json({ message: weatherError });
  }

  if (items.length < MIN_WARDROBE_SIZE) {
    return res.status(422).json({
      message: `Add at least ${MIN_WARDROBE_SIZE} items to your wardrobe to unlock OOTD suggestions`,
      reason: "wardrobe_too_small",
      minItems: MIN_WARDROBE_SIZE,
      itemCount: items.length,
    });
  }

  const missingCategories = missingRequiredCategories(items);
  if (missingCategories.length > 0) {
    return res.status(422).json({
      message: `Add at least one ${missingCategories.join(", ")} item to your wardrobe to unlock OOTD suggestions`,
      reason: "missing_required_categories",
      missingCategories,
    });
  }

  try {
    const { outfits } = await generateOotdSuggestions({ items, weather });
    res.json({ outfits, weather });
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error("Gemini OOTD error:", err.message);
      return res.status(502).json({ message: "Could not generate OOTD suggestions" });
    }
    console.error("OOTD suggest error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
