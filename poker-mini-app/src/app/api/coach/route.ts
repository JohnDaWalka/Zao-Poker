import { NextResponse } from "next/server";
import { heroEquity } from "~/lib/equity-engine";
import { randomUUID } from "crypto";

/** AI coaching response shape (matches original Python backend). */
interface CoachResponse {
  success: boolean;
  request_id: string;
  analysis: string;
  tags: string[];
  confidence: number;
  gto: {
    winRate: number;
    tieRate: number;
    loseRate: number;
    trials: number;
  };
}

export async function POST(request: Request) {
  const requestId = randomUUID().slice(0, 8);
  const startTime = Date.now();

  try {
    const body = await request.json();
    const {
      fid,
      action,
      amount,
      pot_size,
      stack_size,
      cards,
      variant = "Texas Holdem No-Limit",
    } = body;

    // Validate input
    if (!fid || !action || !Array.isArray(cards) || cards.length < 2 || cards.length > 7) {
      return NextResponse.json(
        { success: false, error: "Invalid hand data. Expected: fid, action, cards (2-7)." },
        { status: 400 },
      );
    }

    const heroCards = cards.slice(0, 2);
    const boardCards = cards.length > 2 ? cards.slice(2) : [];

    // Calculate equity
    const equity = heroEquity(heroCards, boardCards, 1, 1000);

    // Call Gemini API for analysis
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;
    let analysis = "";
    let tags: string[] = [];
    let confidence = 0.75;

    if (apiKey) {
      try {
        const prompt = buildCoachPrompt({
          fid,
          action,
          amount: amount ?? 0,
          pot_size: pot_size ?? 0,
          stack_size: stack_size ?? 0,
          heroCards,
          boardCards,
          variant,
          gto: equity,
        });

        const geminiRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
            }),
          },
        );

        if (geminiRes.ok) {
          const geminiData = await geminiRes.json();
          const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          analysis = text;

          // Extract tags from analysis (look for hashtags or bracketed tags)
          const tagMatches = text.match(/#\w+/g) || text.match(/\[([\w\s]+)\]/g);
          if (tagMatches) {
            tags = tagMatches.map((t: string) => t.replace(/[#\[\]]/g, "").trim().toLowerCase());
          }
          if (tags.length === 0) {
            tags = deriveDefaultTags(action, equity.winRate);
          }
          confidence = equity.winRate > 0.6 ? 0.9 : equity.winRate > 0.4 ? 0.75 : 0.6;
        } else {
          analysis = `Gemini API returned ${geminiRes.status}. Using fallback analysis.`;
          tags = deriveDefaultTags(action, equity.winRate);
        }
      } catch (e) {
        analysis = `AI analysis unavailable: ${e instanceof Error ? e.message : String(e)}. Using fallback.`;
        tags = deriveDefaultTags(action, equity.winRate);
      }
    } else {
      analysis = "No GEMINI_API_KEY configured. Fallback analysis: " + buildFallbackAnalysis(action, equity);
      tags = deriveDefaultTags(action, equity.winRate);
    }

    const result: CoachResponse = {
      success: true,
      request_id: requestId,
      analysis,
      tags,
      confidence,
      gto: equity,
    };

    console.log(`[${requestId}] Coach analysis complete (${Date.now() - startTime}ms)`);
    return NextResponse.json(result);
  } catch (e) {
    console.error(`[${requestId}] Coach error:`, e);
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

/** Build a detailed coaching prompt for Gemini. */
function buildCoachPrompt(params: {
  fid: number;
  action: string;
  amount: number;
  pot_size: number;
  stack_size: number;
  heroCards: string[];
  boardCards: string[];
  variant: string;
  gto: { winRate: number; tieRate: number; loseRate: number };
}): string {
  const { action, amount, pot_size, stack_size, heroCards, boardCards, variant, gto } = params;

  const potOdds = pot_size > 0 ? amount / (pot_size + amount) : 0;
  const street = boardCards.length === 0 ? "preflop" : boardCards.length === 3 ? "flop" : boardCards.length === 4 ? "turn" : "river";

  return `You are an elite poker coach analyzing a hand for a player.

HAND CONTEXT:
- Variant: ${variant}
- Street: ${street}
- Hero cards: ${heroCards.join(" ")}
- Board: ${boardCards.length > 0 ? boardCards.join(" ") : "(none yet)"}
- Action taken: ${action}${amount > 0 ? ` $${amount}` : ""}
- Pot size: $${pot_size}
- Stack remaining: $${stack_size}
- Pot odds: ${(potOdds * 100).toFixed(1)}%
- Monte Carlo equity vs random: ${(gto.winRate * 100).toFixed(1)}% win / ${(gto.tieRate * 100).toFixed(1)}% tie

TASK:
1. Analyze whether this action is +EV given the pot odds and equity.
2. Identify any strategic mistakes or missed opportunities.
3. Suggest what the optimal play would be in this spot.
4. Provide 3-5 concise poker tags for this hand (e.g., #overbet, #value-bet, #bluff-catch).

Keep your analysis under 200 words. Be direct and actionable.`;
}

/** Fallback analysis when AI is unavailable. */
function buildFallbackAnalysis(action: string, equity: { winRate: number }): string {
  const winPct = equity.winRate * 100;
  if (action === "fold") {
    return winPct > 40
      ? `You folded with ${winPct.toFixed(0)}% equity. Consider calling or raising with this much equity.`
      : `Folding with ${winPct.toFixed(0)}% equity is reasonable.`;
  }
  if (action === "call") {
    return winPct > 50
      ? `Calling with ${winPct.toFixed(0)}% equity is +EV. Good spot.`
      : `Calling with ${winPct.toFixed(0)}% equity may be -EV without implied odds.`;
  }
  if (action === "raise" || action === "bet" || action === "all_in") {
    return winPct > 55
      ? `Aggressive action with ${winPct.toFixed(0)}% equity is strong. Consider sizing.`
      : `Aggressive with ${winPct.toFixed(0)}% equity — ensure fold equity or bluff opportunity.`;
  }
  return `Check with ${winPct.toFixed(0)}% equity. Consider betting for value or protection.`;
}

function deriveDefaultTags(action: string, winRate: number): string[] {
  const tags: string[] = [];
  if (winRate > 0.65) tags.push("value-bet");
  if (winRate < 0.35) tags.push("bluff-catch");
  if (winRate > 0.5 && winRate < 0.65) tags.push("semi-bluff");
  if (action === "fold" && winRate > 0.4) tags.push("fold-equity");
  if (action === "all_in") tags.push("aggressive");
  if (action === "check") tags.push("pot-control");
  if (tags.length === 0) tags.push("standard-line");
  return tags;
}
