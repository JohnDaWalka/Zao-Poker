import sys
import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
from ai_processor import AIProcessor
import equity_sim

app = FastAPI(title="ZAO Poker AI Coach Bridge")
processor = AIProcessor()

# Auto-detect default provider from environment variables
default_provider = os.getenv("DEFAULT_PROVIDER")
if not default_provider and os.getenv("ASI1_API_KEY"):
    default_provider = "asi1"
elif not default_provider and os.getenv("OPENAI_API_KEY"):
    default_provider = "openai"
elif not default_provider and os.getenv("GROK_API_KEY"):
    default_provider = "grok"

if default_provider:
    try:
        processor.set_default_provider(default_provider)
        print(f"Set default LLM provider to: {default_provider}")
    except ValueError as e:
        print(f"Warning: {e}")


class HandAction(BaseModel):
    fid: int
    action: str
    amount: Optional[float] = None
    pot_size: float
    stack_size: float
    cards: list[str]

@app.post("/api/analyze_action")
async def analyze_action(payload: HandAction):
    # Construct a hand_json schema that the AIProcessor expects
    hand_json = {
        "player_id": str(payload.fid),
        "action": payload.action,
        "amount": payload.amount,
        "pot_size": payload.pot_size,
        "stack_size": payload.stack_size,
        "cards": payload.cards,
        "variant": "Texas Holdem No-Limit"
    }
    
    try:
        # Run the AI hand analysis
        result = processor.analyze_hand(hand_json)
        
        # Calculate Equity using Poker-Suite Engine
        player_hand = "".join(payload.cards)
        equity_data = equity_sim.range_vs_range(player_hand, "random", trials=1000)
        
        return {
            "success": True,
            "analysis": result.analysis,
            "tags": result.tags,
            "confidence": result.confidence,
            "gto": equity_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)
