"use client";

import { useMemo } from "react";
import { useMiniApp } from "@neynar/react";
import { useNeynarUser } from "./useNeynarUser";
import { useRuntimeHost } from "./useRuntimeHost";
import { useUniversalWallet } from "./useUniversalWallet";
import type { UniversalUser } from "~/types/universal";

const GUEST_ID_STORAGE_KEY = "leaksnipe_guest_id";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Deterministic 32-bit FNV-1a hash, turned into a negative integer so it can
 * never collide with a real (positive) Farcaster FID or the fid=1 AI seat. */
function pseudoFidFromString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  const positiveHash = hash >>> 0;
  return positiveHash === 0 ? -2 : -positiveHash;
}

function getOrCreateGuestId(): string {
  if (typeof window === "undefined") return "ssr-guest";

  try {
    const existing = window.localStorage.getItem(GUEST_ID_STORAGE_KEY);
    if (existing) return existing;

    const fresh =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    window.localStorage.setItem(GUEST_ID_STORAGE_KEY, fresh);
    return fresh;
  } catch {
    // Safari private mode / storage blocked: fall back to a session-only id.
    return `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

/**
 * Universal identity hook: Farcaster user -> connected EVM wallet -> guest.
 *
 * This intentionally does NOT replace context?.user?.fid as the source of
 * truth for Farcaster users — it mirrors it exactly. It only adds a real,
 * per-user fallback identity for browsers/wallets outside Farcaster, instead
 * of the previous behavior where every non-Farcaster visitor shared fid 9999.
 */
export function useUniversalUser(): UniversalUser {
  const runtimeHost = useRuntimeHost();
  const wallet = useUniversalWallet();
  const { context } = useMiniApp();
  const { user: neynarUser } = useNeynarUser(context || undefined);

  const guestId = useMemo(() => getOrCreateGuestId(), []);

  return useMemo(() => {
    const farcasterFid = context?.user?.fid;

    if (farcasterFid) {
      return {
        id: `fid:${farcasterFid}`,
        fid: farcasterFid,
        username: neynarUser?.username ?? `User#${farcasterFid}`,
        displayName: neynarUser?.username ?? `User#${farcasterFid}`,
        avatarUrl: neynarUser?.pfp_url,
        walletAddress: wallet.address ?? undefined,
        chainNamespace: wallet.address ? wallet.namespace : undefined,
        runtimeHost: "farcaster",
        authSource: "farcaster",
      };
    }

    if (wallet.isConnected && wallet.address) {
      return {
        id: `wallet:evm:${wallet.address.toLowerCase()}`,
        fid: pseudoFidFromString(`evm:${wallet.address.toLowerCase()}`),
        username: shortAddress(wallet.address),
        displayName: shortAddress(wallet.address),
        walletAddress: wallet.address,
        chainNamespace: wallet.namespace,
        runtimeHost,
        authSource: "wallet",
      };
    }

    return {
      id: `guest:${guestId}`,
      fid: pseudoFidFromString(`guest:${guestId}`),
      username: "Guest",
      displayName:
        runtimeHost === "ios_safari"
          ? "iPhone Guest"
          : runtimeHost === "android_chrome"
            ? "Android Guest"
            : "Browser Guest",
      runtimeHost,
      authSource: "guest",
    };
  }, [context?.user?.fid, guestId, neynarUser, runtimeHost, wallet]);
}
