import { NextResponse } from "next/server";
import { heroEquity, heroVsRange } from "~/lib/equity-engine";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { heroCards, boardCards, opponentRange, opponents = 1, trials = 1000 } = body;

    if (!Array.isArray(heroCards) || heroCards.length !== 2) {
      return NextResponse.json(
        { success: false, error: "heroCards must be an array of 2 card strings" },
        { status: 400 },
      );
    }

    let result;
    if (opponentRange && typeof opponentRange === "string") {
      result = heroVsRange(heroCards, opponentRange, boardCards || [], trials);
    } else {
      result = heroEquity(heroCards, boardCards || [], opponents, trials);
    }

    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const hero = searchParams.get("hero");
  const board = searchParams.get("board");
  const trials = parseInt(searchParams.get("trials") || "1000", 10);

  if (!hero) {
    return NextResponse.json(
      { success: false, error: "Missing ?hero=AsKs (2 card codes)" },
      { status: 400 },
    );
  }

  try {
    const heroCards = [hero.slice(0, 2), hero.slice(2, 4)].filter(Boolean);
    const boardCards = board ? board.split(",") : [];
    const result = heroEquity(heroCards, boardCards, 1, trials);
    return NextResponse.json({ success: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
