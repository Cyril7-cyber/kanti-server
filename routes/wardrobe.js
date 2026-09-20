const express = require("express");
const authenticate = require("../middleware/authenticate");
const { analyzeClothingImage, GeminiError } = require("../utils/gemini");

const router = express.Router();

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

router.post("/analyze", authenticate, async (req, res) => {
  const { image, mimeType } = req.body;

  if (!image || typeof image !== "string") {
    return res.status(400).json({ message: "image (base64) is required" });
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return res.status(400).json({
      message: `mimeType must be one of: ${ALLOWED_MIME_TYPES.join(", ")}`,
    });
  }

  try {
    const insights = await analyzeClothingImage(image, mimeType);
    res.json(insights);
  } catch (err) {
    if (err instanceof GeminiError) {
      console.error("Gemini analyze error:", err.message);
      return res.status(502).json({ message: "Could not analyze image" });
    }
    console.error("Wardrobe analyze error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

module.exports = router;
