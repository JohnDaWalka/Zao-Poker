import { NextRequest, NextResponse } from "next/server";
import { buildCoachResponse } from "~/lib/game-theory";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const localResponse = buildCoachResponse(
      {
        holeCards: body.cards ?? [],
        boardCards: body.board ?? [],
        potSize: Number(body.pot_size || 0),
        toCall: Number(body.to_call || 0),
        stackSize: Number(body.stack_size || 0),
        opponentCount: Number(body.opponent_count || 1),
        position: typeof body.position === "string" ? body.position : undefined,
        history: Array.isArray(body.action_history) ? body.action_history : [],
      },
      typeof body.action === "string" ? body.action : undefined,
    );

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      return NextResponse.json(localResponse);
    }

    try {
      const aiResponse = await fetch(`${backendUrl}/api/analyze_action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!aiResponse.ok) {
        return NextResponse.json(localResponse);
      }

      const remoteData = await aiResponse.json();
      return NextResponse.json({
        ...localResponse,
        analysis: remoteData.analysis || localResponse.analysis,
        tags: Array.from(new Set([...(localResponse.tags ?? []), ...(remoteData.tags ?? [])])),
        confidence:
          typeof remoteData.confidence === "number"
            ? remoteData.confidence
            : localResponse.confidence,
        remote: remoteData,
      });
    } catch {
      return NextResponse.json(localResponse);
    }
  } catch (error) {
    console.error("AI Bridge error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
