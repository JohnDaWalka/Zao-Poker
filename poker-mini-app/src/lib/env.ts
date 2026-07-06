// Centralized env validation for the Zao Poker mini app.
// Warns (never throws) so a missing var degrades a feature, not the whole app.

// and a missing var (e.g. a newly-added one not yet set in Vercel) must
// degrade a feature, not crash the whole mini app.
function warnIfMissing(scope: string, vars: Record<string, string | undefined>) {
  if (process.env.NODE_ENV !== "production") return;

  const missing = Object.entries(vars)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    console.warn(`[env] Missing ${scope} env vars: ${missing.join(", ")}`);
  }
}

export function getPublicEnv() {
  const vars = {
    NEXT_PUBLIC_APP_URL:
      process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_URL,
    NEXT_PUBLIC_RENDER_API_URL: process.env.NEXT_PUBLIC_RENDER_API_URL,
    NEXT_PUBLIC_RENDER_WS_URL: process.env.NEXT_PUBLIC_RENDER_WS_URL,
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID:
      process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
    NEXT_PUBLIC_PRIVY_APP_ID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    NEXT_PUBLIC_ZERODEV_BUNDLER_RPC: process.env.NEXT_PUBLIC_ZERODEV_BUNDLER_RPC,
    NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC: process.env.NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC,
  };

  warnIfMissing("public", {
    NEXT_PUBLIC_APP_URL: vars.NEXT_PUBLIC_APP_URL,
  });

  if (
    process.env.NODE_ENV === "production" &&
    (vars.NEXT_PUBLIC_RENDER_API_URL || vars.NEXT_PUBLIC_RENDER_WS_URL) &&
    (!vars.NEXT_PUBLIC_RENDER_API_URL || !vars.NEXT_PUBLIC_RENDER_WS_URL)
  ) {
    console.warn(
      "[env] Render lobby is partially configured. Set both NEXT_PUBLIC_RENDER_API_URL and NEXT_PUBLIC_RENDER_WS_URL."
    );
  }

  return {
    appUrl: vars.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
    renderApiUrl: vars.NEXT_PUBLIC_RENDER_API_URL ?? "",
    renderWsUrl: vars.NEXT_PUBLIC_RENDER_WS_URL ?? "",
    hasRenderLobby: Boolean(
      vars.NEXT_PUBLIC_RENDER_API_URL && vars.NEXT_PUBLIC_RENDER_WS_URL
    ),
    // Empty string (rather than undefined) lets callers do a simple truthy
    // check to decide whether the WalletConnect connector can be enabled.
    walletConnectProjectId: vars.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
    // All three below are optional opt-ins for the Privy/ZeroDev smart
    // account path. Email/social login is disabled until an app ID is set;
    // gas sponsorship is disabled until a paymaster RPC is set (configure
    // spending limits in the ZeroDev dashboard before enabling it).
    privyAppId: vars.NEXT_PUBLIC_PRIVY_APP_ID ?? "",
    zeroDevBundlerRpc: vars.NEXT_PUBLIC_ZERODEV_BUNDLER_RPC ?? "",
    zeroDevPaymasterRpc: vars.NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC ?? "",
  };
}

/**
 * Build a public API URL that works across environments:
 * - Local dev: `http://localhost:3000/api/table`
 * - Vercel (self-contained): `https://<app>.vercel.app/api/table`
 * - Render split: `https://<render>.onrender.com/api/table`
 */
export function getApiUrl(path: string): string {
  const env = getPublicEnv();
  const baseUrl = env.hasRenderLobby
    ? env.renderApiUrl.replace(/\/$/, "")
    : env.appUrl.replace(/\/$/, "");
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${cleanPath}`;
}

export function getServerEnv() {
  const vars = {
    TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
    NEYNAR_API_KEY: process.env.NEYNAR_API_KEY,
  };

  warnIfMissing("server", vars);

  return {
    tursoDatabaseUrl: vars.TURSO_DATABASE_URL,
    tursoAuthToken: vars.TURSO_AUTH_TOKEN,
    neynarApiKey: vars.NEYNAR_API_KEY,
  };
}
// deploy-trigger
// deploy: VERCEL_TOKEN should be live
// deploy: testing VERCEL_TOKEN
