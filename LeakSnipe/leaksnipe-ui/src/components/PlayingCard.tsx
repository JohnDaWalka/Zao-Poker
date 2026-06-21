const SUITS: Record<string, { color: string }> = {
  s: { color: "#1a1a2e" },
  h: { color: "#cc2244" },
  d: { color: "#cc2244" },
  c: { color: "#1a1a2e" },
};

type PlayingCardProps = {
  card?: string;
  faceDown?: boolean;
  small?: boolean;
};

function CardSuit({ suit, size }: { suit: string; size: number }) {
  const meta = SUITS[suit] ?? { color: "#333" };
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: meta.color,
    "aria-hidden": true as const,
  };

  switch (suit) {
    case "h":
      return (
        <svg {...common}>
          <path d="M12 21c-4.5-3.8-7.5-6.8-7.5-10.2C4.5 8.2 7.4 6 10.2 6c1.6 0 3 .8 3.8 2 0.8-1.2 2.2-2 3.8-2 2.8 0 5.7 2.2 5.7 4.8C19.5 14.2 16.5 17.2 12 21z" />
        </svg>
      );
    case "d":
      return (
        <svg {...common}>
          <path d="M12 2 21 12 12 22 3 12 12 2z" />
        </svg>
      );
    case "c":
      return (
        <svg {...common}>
          <path d="M12 3c-1.8 0-3.2 1.2-3.6 2.8C6.8 5.2 5.5 5 4.2 5.6 2.6 6.2 1.5 7.8 1.8 9.5c0.3 1.5 1.5 2.7 3 3.1-0.2 0.8-0.1 1.7 0.3 2.5 0.8 1.5 2.5 2.2 4.1 1.8 0.8 1.5 2.4 2.5 4.2 2.5s3.4-1 4.2-2.5c1.6 0.4 3.3-0.3 4.1-1.8 0.4-0.8 0.5-1.7 0.3-2.5 1.5-0.4 2.7-1.6 3-3.1 0.3-1.7-0.8-3.3-2.4-3.9-1.3-0.6-2.6-0.4-3.8 0.2C15.2 4.2 13.8 3 12 3z" />
        </svg>
      );
    case "s":
    default:
      return (
        <svg {...common}>
          <path d="M12 2c0 0-6 6.5-6 10.3 0 2.8 2.2 5 5 5 1.2 0 2.3-0.4 3.2-1.1 0.9 0.7 2 1.1 3.2 1.1 2.8 0 5-2.2 5-5C17 8.5 12 2 12 2zm-1.2 16.8 2.4 3.2 2.4-3.2h-4.8z" />
        </svg>
      );
  }
}

export function PlayingCard({ card, faceDown = false, small = false }: PlayingCardProps) {
  const w = small ? 36 : 50;
  const h = small ? 50 : 70;
  const suitSize = small ? 10 : 12;
  const suitLarge = small ? 18 : 22;

  if (faceDown || !card) {
    return (
      <div
        className="playing-card face-down"
        style={{ width: w, height: h }}
        aria-hidden={faceDown}
      />
    );
  }

  const suitChar = card.slice(-1).toLowerCase();
  const rank = card.slice(0, -1).toUpperCase();
  const suit = SUITS[suitChar] ?? { color: "#333" };

  return (
    <div className="playing-card" style={{ width: w, height: h }}>
      <span className="card-rank" style={{ color: suit.color }}>
        {rank}
      </span>
      <span className="card-suit-sm" style={{ color: suit.color }}>
        <CardSuit suit={suitChar} size={suitSize} />
      </span>
      <span className="card-suit-lg" style={{ color: suit.color }}>
        <CardSuit suit={suitChar} size={suitLarge} />
      </span>
    </div>
  );
}

export function parseCardList(cards?: string | null): string[] {
  if (!cards) return [];
  return cards
    .trim()
    .split(/\s+/)
    .filter((c) => c.length >= 2);
}
