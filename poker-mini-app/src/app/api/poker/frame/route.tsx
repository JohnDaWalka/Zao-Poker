import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";

export const dynamic = 'force-dynamic';

// Card suit symbols
const SUITS: Record<string, string> = {
  's': '♠', 'h': '♥', 'd': '♦', 'c': '♣',
};

const SUIT_COLORS: Record<string, string> = {
  's': '#94a3b8', 'h': '#ef4444', 'd': '#3b82f6', 'c': '#22c55e',
};

function parseCard(card: string): { rank: string; suit: string; color: string } {
  if (!card || card === '?') return { rank: '?', suit: '', color: '#94a3b8' };
  const rank = card[0];
  const suitKey = card[1];
  return {
    rank,
    suit: SUITS[suitKey] ?? suitKey,
    color: SUIT_COLORS[suitKey] ?? '#94a3b8',
  };
}

function CardComponent({ card, hidden = false }: { card: string; hidden?: boolean }) {
  if (hidden) {
    return (
      <div tw="flex items-center justify-center w-20 h-28 bg-slate-700 rounded-lg border-2 border-slate-500 mr-2">
        <span tw="text-3xl">🂠</span>
      </div>
    );
  }
  const { rank, suit, color } = parseCard(card);
  return (
    <div tw="flex flex-col items-center justify-center w-20 h-28 bg-white rounded-lg border-2 border-slate-300 mr-2 shadow-lg">
      <span tw="text-2xl font-bold" style={{ color }}>{rank}</span>
      <span tw="text-3xl" style={{ color }}>{suit}</span>
    </div>
  );
}

function LobbyScene() {
  return (
    <div tw="flex h-full w-full flex-col justify-center items-center relative" style={{ backgroundColor: '#0f172a' }}>
      {/* Felt background pattern */}
      <div tw="absolute inset-0 opacity-10" style={{
        backgroundImage: 'radial-gradient(circle at 50% 50%, #1e293b 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }} />
      
      {/* Logo / Title */}
      <div tw="flex flex-col items-center z-10">
        <div tw="flex items-center justify-center w-32 h-32 rounded-full mb-6" style={{ backgroundColor: '#dc2626' }}>
          <span tw="text-6xl">♠️</span>
        </div>
        <h1 tw="text-7xl font-black text-white tracking-tight">ZAO Poker</h1>
        <p tw="text-3xl mt-4 text-slate-400">GTO Coach · Multiplayer · Farcaster</p>
      </div>
      
      {/* CTA */}
      <div tw="flex mt-12 px-8 py-4 rounded-xl" style={{ backgroundColor: '#dc2626' }}>
        <span tw="text-3xl font-bold text-white">▶ Play Now</span>
      </div>
      
      {/* Stats row */}
      <div tw="flex mt-10 gap-8">
        <div tw="flex flex-col items-center">
          <span tw="text-4xl font-bold text-white">6</span>
          <span tw="text-lg text-slate-500">Max Players</span>
        </div>
        <div tw="flex flex-col items-center">
          <span tw="text-4xl font-bold text-white">NLHE</span>
          <span tw="text-lg text-slate-500">Game Type</span>
        </div>
        <div tw="flex flex-col items-center">
          <span tw="text-4xl font-bold text-white">AI</span>
          <span tw="text-lg text-slate-500">GTO Coach</span>
        </div>
      </div>
    </div>
  );
}

function TableScene({
  community = [],
  holeCards = [],
  pot = 0,
  street = 'preflop',
  facing = 0,
  myStack = 0,
  history = '',
  advice = '',
}: {
  community: string[];
  holeCards: string[];
  pot: number;
  street: string;
  facing: number;
  myStack: number;
  history: string;
  advice: string;
}) {
  const streetLabels: Record<string, string> = {
    preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River',
  };

  return (
    <div tw="flex h-full w-full flex-col relative" style={{ backgroundColor: '#0f172a' }}>
      {/* Table felt */}
      <div tw="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 50% 55%, #166534 0%, #0f172a 70%)',
      }} />
      
      {/* Top bar: Street + Pot */}
      <div tw="flex justify-between items-center px-8 py-4 z-10">
        <div tw="flex items-center px-4 py-2 rounded-lg" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <span tw="text-xl font-bold text-white uppercase tracking-wider">{streetLabels[street] ?? street}</span>
        </div>
        <div tw="flex items-center px-6 py-3 rounded-xl" style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}>
          <span tw="text-2xl mr-2">🍯</span>
          <span tw="text-3xl font-black text-yellow-400">{pot.toLocaleString()}</span>
        </div>
      </div>
      
      {/* Center: Community cards */}
      <div tw="flex flex-col items-center justify-center flex-1 z-10">
        <div tw="flex items-center">
          {community.length > 0 ? (
            community.map((c, i) => <CardComponent key={i} card={c} />)
          ) : (
            <>
              <CardComponent card="?" hidden />
              <CardComponent card="?" hidden />
              <CardComponent card="?" hidden />
              <CardComponent card="?" hidden />
              <CardComponent card="?" hidden />
            </>
          )}
        </div>
        
        {/* Facing bet indicator */}
        {facing > 0 && (
          <div tw="flex mt-4 px-4 py-2 rounded-full" style={{ backgroundColor: 'rgba(220,38,38,0.8)' }}>
            <span tw="text-lg font-bold text-white">Facing: {facing.toLocaleString()}</span>
          </div>
        )}
      </div>
      
      {/* Bottom: Player cards + stack */}
      <div tw="flex justify-between items-end px-8 pb-6 z-10">
        <div tw="flex flex-col">
          <span tw="text-sm text-slate-400 mb-1">Your Cards</span>
          <div tw="flex">
            {holeCards.length >= 2 ? (
              <>
                <CardComponent card={holeCards[0]} />
                <CardComponent card={holeCards[1]} />
              </>
            ) : (
              <>
                <CardComponent card="?" hidden />
                <CardComponent card="?" hidden />
              </>
            )}
          </div>
        </div>
        
        <div tw="flex flex-col items-end">
          <span tw="text-sm text-slate-400 mb-1">Your Stack</span>
          <span tw="text-4xl font-black text-green-400">{myStack.toLocaleString()}</span>
        </div>
      </div>
      
      {/* AI Advice overlay */}
      {advice && (
        <div tw="absolute top-20 right-8 z-20 flex flex-col items-end">
          <div tw="flex items-center px-4 py-2 rounded-t-lg" style={{ backgroundColor: '#7c3aed' }}>
            <span tw="text-lg font-bold text-white">🧠 AI Coach</span>
          </div>
          <div tw="px-4 py-3 rounded-b-lg rounded-tl-lg max-w-sm" style={{ backgroundColor: 'rgba(124,58,237,0.9)' }}>
            <span tw="text-lg text-white">{advice}</span>
          </div>
        </div>
      )}
      
      {/* Action history */}
      {history && (
        <div tw="absolute bottom-24 left-1/2 transform -translate-x-1/2 z-10">
          <div tw="flex px-3 py-1 rounded-full" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <span tw="text-sm text-slate-300 font-mono">{history}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function NotSeatedScene() {
  return (
    <div tw="flex h-full w-full flex-col justify-center items-center relative" style={{ backgroundColor: '#0f172a' }}>
      <div tw="absolute inset-0" style={{
        background: 'radial-gradient(ellipse at 50% 55%, #1e293b 0%, #0f172a 70%)',
      }} />
      <div tw="flex flex-col items-center z-10">
        <span tw="text-8xl mb-6">💺</span>
        <h1 tw="text-5xl font-bold text-white">Take a Seat</h1>
        <p tw="text-2xl mt-4 text-slate-400">Join the table to start playing</p>
        <div tw="flex mt-8 px-8 py-4 rounded-xl" style={{ backgroundColor: '#dc2626' }}>
          <span tw="text-2xl font-bold text-white">Sit Down</span>
        </div>
      </div>
    </div>
  );
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scene = searchParams.get('scene') ?? 'table';
  const community = (searchParams.get('community') ?? '').split(',').filter(Boolean);
  const holeCards = (searchParams.get('hole') ?? '').split(',').filter(Boolean);
  const pot = Number(searchParams.get('pot') ?? 0);
  const street = searchParams.get('street') ?? 'preflop';
  const facing = Number(searchParams.get('facing') ?? 0);
  const myStack = Number(searchParams.get('stack') ?? 0);
  const history = searchParams.get('history') ?? '';
  const advice = searchParams.get('advice') ?? '';

  let content;
  switch (scene) {
    case 'lobby':
      content = <LobbyScene />;
      break;
    case 'not_seated':
      content = <NotSeatedScene />;
      break;
    default:
      content = (
        <TableScene
          community={community}
          holeCards={holeCards}
          pot={pot}
          street={street}
          facing={facing}
          myStack={myStack}
          history={history}
          advice={advice}
        />
      );
  }

  return new ImageResponse(content, {
    width: 1200,
    height: 630,
  });
}
