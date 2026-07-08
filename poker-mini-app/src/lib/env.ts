// Centralized env validation for the Zao Poker mini app.
// Warns (never throws) so a missing var degrades a feature, not the whole app.

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
    walletConnectProjectId: vars.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
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
  
  if (env.hasRenderLobby) {
    const baseUrl = env.renderApiUrl.replace(/\/$/, "");
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    return `${baseUrl}${cleanPath}`;
  }
  
  if (typeof window !== "undefined") {
    return path.startsWith("/") ? path : `/${path}`;
  }
  
  const baseUrl = env.appUrl.replace(/\/$/, "");
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
