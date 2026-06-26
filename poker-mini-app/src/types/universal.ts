export type RuntimeHost =
  | "farcaster"
  | "ios_safari"
  | "android_chrome"
  | "desktop_browser"
  | "unknown_browser";

export type ChainNamespace = "evm" | "solana" | "bitcoin" | "litecoin";

export type AuthSource = "farcaster" | "wallet" | "guest";

export type UniversalUser = {
  /** Stable cross-runtime identifier for future Render/WebSocket lobbies. */
  id: string;
  /** Stable integer identity for the existing players table (fid INTEGER PRIMARY KEY).
   * Real Farcaster FIDs are positive. Wallet/guest users get a deterministic
   * negative pseudo-fid so they never collide with a real FID or the fid=1 AI seat. */
  fid: number;
  username: string;
  displayName: string;
  avatarUrl?: string;
  walletAddress?: string;
  chainNamespace?: ChainNamespace;
  runtimeHost: RuntimeHost;
  authSource: AuthSource;
};

export type UniversalWallet = {
  namespace: ChainNamespace;
  address: string | null;
  chainId?: number;
  isConnected: boolean;
  connectorName?: string;
};
