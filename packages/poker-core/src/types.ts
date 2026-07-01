export type GameType = "NLHE" | "PLO" | "PLO8" | "STUD8";
export type TableStatus = "waiting" | "seated" | "full" | "in_game";

export interface UniversalUser {
  id: string;
  fid: number;
  username: string;
  displayName?: string;
  avatarUrl?: string;
  walletAddress?: string;
  runtimeHost?: string;
}

export interface Seat {
  seatNumber: number;
  user: UniversalUser | null;
  stack: number;
  currentBet: number;
  isReady: boolean;
  isBot: boolean;
  holeCards: string[];
  status?: string;
  hasActed?: boolean;
}

export interface PokerTable {
  id: string;
  name: string;
  game: GameType;
  stakes: string;
  maxPlayers: number;
  buyIn: number;
  visibility: "public" | "club";
  clubId: string | null;
  clubName: string | null;
  status: TableStatus;
  createdAt: number;
  startTime?: string | null;
  board: string[];
  potSize: number;
  currentBet: number;
  phase: string;
  actionHistory: string[];
  currentTurnFid: number | null;
  seats: Seat[];
}

export interface LobbyState {
  tables: PokerTable[];
  updatedAt: number;
}

export interface ServerMessage {
  type: "state" | "error";
  payload: LobbyState | { message: string };
}

export const AUTOPLAY_MAX_TURNS = 12;

export const BLIND_LEVELS = [
  { sb: 5, bb: 10, ante: 2.5 },
  { sb: 10, bb: 20, ante: 5 },
  { sb: 15, bb: 30, ante: 7.5 },
  { sb: 25, bb: 50, ante: 12.5 },
  { sb: 50, bb: 100, ante: 25 },
  { sb: 75, bb: 150, ante: 37.5 },
  { sb: 100, bb: 200, ante: 50 },
  { sb: 150, bb: 300, ante: 75 },
  { sb: 200, bb: 400, ante: 100 },
  { sb: 300, bb: 600, ante: 150 },
  { sb: 400, bb: 800, ante: 200 },
  { sb: 500, bb: 1000, ante: 250 },
  { sb: 600, bb: 1200, ante: 300 },
  { sb: 800, bb: 1600, ante: 400 },
  { sb: 1000, bb: 2000, ante: 500 },
  { sb: 1500, bb: 3000, ante: 750 },
  { sb: 2000, bb: 4000, ante: 1000 },
  { sb: 3000, bb: 6000, ante: 1500 },
  { sb: 4000, bb: 8000, ante: 2000 },
  { sb: 5000, bb: 10000, ante: 2500 },
  { sb: 6000, bb: 12000, ante: 3000 }
];

export const DEFAULT_LOBBY_BOTS: Record<string, { fid: number; username: string; pfp_url: string; preferredSeat: number }> = {
  room_1: {
    fid: 1,
    username: "PokerCoachJohnny",
    pfp_url: "https://i.imgur.com/k2j4j3V.jpeg",
    preferredSeat: 1,
  },
  room_2: {
    fid: 900001,
    username: "OrbitGrinder",
    pfp_url: "https://i.imgur.com/k2j4j3V.jpeg",
    preferredSeat: 1,
  },
  room_3: {
    fid: 900002,
    username: "RangeSpectre",
    pfp_url: "https://i.imgur.com/k2j4j3V.jpeg",
    preferredSeat: 1,
  },
};
