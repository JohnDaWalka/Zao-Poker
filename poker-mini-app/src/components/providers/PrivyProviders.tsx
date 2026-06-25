"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { getPublicEnv } from "~/lib/env";

/**
 * Email/social login + embedded smart wallets, opt-in via
 * NEXT_PUBLIC_PRIVY_APP_ID. Without it configured, renders children
 * directly — Farcaster auth and the existing wagmi wallet connectors keep
 * working exactly as before.
 */
export function PrivyProviders({ children }: { children: React.ReactNode }) {
  const { privyAppId } = getPublicEnv();

  if (!privyAppId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={privyAppId}
      config={{
        loginMethods: ["email", "google", "apple"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        appearance: {
          theme: "dark",
          accentColor: "#22d3ee",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
