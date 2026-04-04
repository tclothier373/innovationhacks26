import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export async function parseFoodPrompt(userPrompt) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
  });

  const prompt = `
Extract dietary preference and price range from this prompt:

"${userPrompt}"

Return ONLY valid JSON:
{
  "diet": "...",
  "price_range": "..."
}

Rules:
- diet: vegan | vegetarian | keto | halal | gluten-free | none
- price_range: cheap | moderate | expensive
- Defaults:
  diet = "none"
  price_range = "moderate"
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();

  try {
    return JSON.parse(text);
  } catch (e) {
    // fallback if model messes up
    return {
      diet: "none",
      price_range: "moderate",
    };
  }
}