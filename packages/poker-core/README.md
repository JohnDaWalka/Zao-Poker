# @zao-poker/core

Shared poker engine logic for Zao-Poker (used by Vercel mini-app and Render lobby server).

## Usage

```ts
import { createDeck, PokerTable, getCurrentBlinds } from '@zao-poker/core';
```

## Structure

- `types.ts` - Shared types (PokerTable, Seat, LobbyState, etc.)
- `game.ts` - Pure functions (deck, blinds, basic AI decisions)

## Future

Move more game logic (dealNewHand, advanceGame, full action handling) here with a pluggable DB interface so Vercel API routes and the standalone Render lobby can share 100% of the implementation without duplication.
