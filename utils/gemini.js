const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const PROMPT = `You are analyzing a photo of a single clothing item for a wardrobe app.
Identify its dominant color(s), pattern, and fabric type.
Respond with your best guess even if you're not fully certain.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    colors: {
      type: "array",
      items: { type: "string" },
      description: "1-2 dominant colors of the item, e.g. ['Navy']",
    },
    pattern: {
      type: "string",
      description: "e.g. Solid, Print, Striped, Floral, Checked",
    },
    fabricType: {
      type: "string",
      description: "e.g. Cotton, Denim, Wool, Polyester, Linen, Knit",
    },
  },
  required: ["colors", "pattern", "fabricType"],
};

class GeminiError extends Error {}

// Calls Gemini's vision model on a single clothing photo and returns
// structured wardrobe insights. Throws GeminiError on any failure so the
// route can turn it into a clean 502 without leaking upstream details.
async function analyzeClothingImage(base64Image, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new GeminiError("GEMINI_API_KEY is not configured");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: PROMPT },
            { inline_data: { mime_type: mimeType, data: base64Image } },
          ],
        },
      ],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new GeminiError(`Gemini request failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new GeminiError("Gemini response had no content");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiError("Gemini response was not valid JSON");
  }

  if (
    !Array.isArray(parsed.colors) ||
    typeof parsed.pattern !== "string" ||
    typeof parsed.fabricType !== "string"
  ) {
    throw new GeminiError("Gemini response did not match the expected shape");
  }

  return {
    colors: parsed.colors,
    pattern: parsed.pattern,
    fabricType: parsed.fabricType,
  };
}

module.exports = { analyzeClothingImage, GeminiError };
