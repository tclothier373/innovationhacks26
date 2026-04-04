import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function parseFoodPrompt(userPrompt) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
  });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `
Extract structured food preferences from this prompt:

"${userPrompt}"

Return ONLY valid JSON:

{
  "diet": "string",
  "price_range": "string",
  "cuisine": "string",
  "food": "string",
  "keywords": ["string"]
}

Rules:
- diet: none | vegetarian | vegan | gluten-free | nut-free | dairy-free | halal | kosher
- price_range: cheap | moderate | expensive | super expensive
- cuisine: type or "any"
- food: specific dish or "any"
- keywords: descriptors

Defaults:
diet="none", price_range="moderate", cuisine="any", food="any", keywords=[]
`
          }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  return JSON.parse(result.response.text());
}