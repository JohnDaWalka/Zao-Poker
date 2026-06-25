"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Button } from "../Button";

/**
 * Email/social login entry point for non-crypto-native players. Only ever
 * rendered by a parent that already confirmed NEXT_PUBLIC_PRIVY_APP_ID is
 * set (PrivyProvider must be mounted, or usePrivy() throws) — see Header.tsx.
 */
export function PrivyLoginButton() {
  const { ready, authenticated, user, login, logout } = usePrivy();

  if (!ready) return null;

  if (authenticated) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">
          {user?.email?.address ?? user?.google?.email ?? "Signed in"}
        </span>
        <Button variant="outline" size="sm" onClick={() => logout()}>
          Sign out
        </Button>
      </div>
    );
  }

  return (
    <Button variant="secondary" size="sm" onClick={() => login()}>
      Continue with Email
    </Button>
  );
}
