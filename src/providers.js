// LLM provider abstraction: Claude (Anthropic) and Gemini (Google).
// Both exposed through a single callLLM({ system, user, maxTokens }) -> string.

const PROVIDER = (process.env.PROVIDER || "claude").toLowerCase();

async function callClaude({ system, user, maxTokens = 8000 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set (see .env.example)");
  const model = process.env.CLAUDE_MODEL || "claude-sonnet-4-5";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API error ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  return data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
}

async function callGemini({ system, user, maxTokens = 8000 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (see .env.example)");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("\n");
}

// Mock provider for offline testing: MOCK_LLM=1 npm start
async function callMock({ user }) {
  const { mockResponse } = await import("./mock.js");
  return mockResponse(user);
}

export async function callLLM(opts) {
  if (process.env.MOCK_LLM === "1") return callMock(opts);
  if (PROVIDER === "gemini") return callGemini(opts);
  return callClaude(opts);
}

export function providerLabel() {
  if (process.env.MOCK_LLM === "1") return "mock";
  return PROVIDER === "gemini"
    ? `gemini (${process.env.GEMINI_MODEL || "gemini-2.5-flash"})`
    : `claude (${process.env.CLAUDE_MODEL || "claude-sonnet-4-5"})`;
}
