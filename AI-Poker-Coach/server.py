import sys
import os
import re
from fastapi import FastAPI, HTTPException
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator
from typing import Dict, Any, Optional
from ai_processor import AIProcessor
import equity_sim

app = FastAPI(title="ZAO Poker AI Coach Bridge")
processor = AIProcessor()


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request, exc: RequestValidationError):
    return JSONResponse(
        status_code=400,
        content={"detail": jsonable_encoder(exc.errors())},
    )

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
        print(f"[startup] LLM provider configured: {default_provider}")
    except ValueError as e:
        print(f"[startup] FATAL ERROR: Invalid LLM provider '{default_provider}'", file=sys.stderr)
        print("[startup] Supported providers: local, openai, grok, asi1", file=sys.stderr)
        sys.exit(1)


class HandAction(BaseModel):
    fid: int
    action: str
    amount: Optional[float] = None
    pot_size: float
    stack_size: float
    cards: list[str]

    @field_validator("cards")
    @classmethod
    def validate_cards(cls, value: list[str]) -> list[str]:
        if len(value) not in (2, 4, 5, 6, 7):
            raise ValueError("cards must be 2 hole cards + 0-5 board cards (total 2-7)")

        valid_card = re.compile(r"^[2-9TJQKA][shdc]$", re.IGNORECASE)
        for card in value:
            if not valid_card.match(card):
                raise ValueError(
                    f"Invalid card format: {card!r}. Use format: rank+suit (e.g., 'As', 'Kh')"
                )

        return value

    @field_validator("pot_size", "stack_size", "amount")
    @classmethod
    def validate_positive(cls, value: Optional[float]) -> Optional[float]:
        if value is not None and value < 0:
            raise ValueError("Amount must be non-negative")
        return value

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
        hero_cards = payload.cards[:2]
        board_cards = payload.cards[2:] or None
        equity_data = equity_sim.hero_vs_random_opponent(
            hero_cards,
            board_cards,
            trials=1000,
        )
        
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
