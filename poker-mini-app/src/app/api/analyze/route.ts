import { NextRequest, NextResponse } from "next/server";

const ASI1_ENDPOINT = "https://api.asi1.ai/v1/chat/completions";

// Last-resort fallback when the AI-Poker-Coach backend is unreachable or errors.
// Calls ASI:One directly so the user still gets feedback instead of a hard failure.
async function analyzeWithAsi1Fallback(body: unknown) {
  const apiKey = process.env.ASI1_API_KEY;
  if (!apiKey) {
    throw new Error("ASI1_API_KEY not configured for fallback");
  }

  const prompt =
    "Briefly analyze this poker action and give one strategic tip. " +
    "Respond in 1-2 sentences.\n\n" +
    JSON.stringify(body);

  const response = await fetch(ASI1_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "asi1",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
    }),
  });

  if (!response.ok) {
    throw new Error(`ASI:One fallback request failed: ${response.status}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("ASI:One fallback returned no content");
  }

  return {
    success: true,
    analysis: content,
    tags: [],
    confidence: 0.5,
    gto: null,
    provider: "asi1-fallback",
  };
}

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    // Call the Python AI-Poker-Coach FastAPI bridge
    const backendUrl = process.env.BACKEND_URL || "http://127.0.0.1:8080";
    const aiResponse = await fetch(`${backendUrl}/api/analyze_action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (aiResponse.ok) {
      return NextResponse.json(await aiResponse.json());
    }

    console.error("AI backend returned an error status:", aiResponse.status);
  } catch (error) {
    console.error("AI backend unreachable:", error);
  }

  try {
    return NextResponse.json(await analyzeWithAsi1Fallback(body));
  } catch (fallbackError) {
    console.error("ASI:One fallback error:", fallbackError);
    return NextResponse.json(
      { success: false, error: "AI analysis unavailable" },
      { status: 500 },
    );
  }
}
