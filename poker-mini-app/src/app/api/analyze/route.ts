import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Call the Python AI-Poker-Coach FastAPI bridge running on port 8000
    const aiResponse = await fetch("http://127.0.0.1:8000/api/analyze_action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!aiResponse.ok) {
      const err = await aiResponse.text();
      return NextResponse.json({ success: false, error: err }, { status: aiResponse.status });
    }

    const data = await aiResponse.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("AI Bridge error:", error);
    return NextResponse.json({ success: false, error: "Internal Server Error" }, { status: 500 });
  }
}
