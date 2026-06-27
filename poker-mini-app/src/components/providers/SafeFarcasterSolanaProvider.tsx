"use client";

import React, { createContext, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { sdk } from '@farcaster/miniapp-sdk';

const FarcasterSolanaProvider = dynamic(
  () => import('@farcaster/mini-app-solana').then(mod => mod.FarcasterSolanaProvider),
  { ssr: false }
);

type SafeFarcasterSolanaProviderProps = {
  endpoint: string;
  children: React.ReactNode;
};

const SOLANA_PROVIDER_CHECK_TIMEOUT_MS = 1500;

const SolanaProviderContext = createContext<{ hasSolanaProvider: boolean }>({ hasSolanaProvider: false });

export function SafeFarcasterSolanaProvider({ endpoint, children }: SafeFarcasterSolanaProviderProps) {
  const [hasSolanaProvider, setHasSolanaProvider] = useState<boolean>(false);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;

    (async () => {
      try {
        const provider = await Promise.race([
          sdk.wallet.getSolanaProvider(),
          new Promise<null>((resolve) => {
            timeoutId = window.setTimeout(() => resolve(null), SOLANA_PROVIDER_CHECK_TIMEOUT_MS);
          }),
        ]);

        if (!cancelled) {
          setHasSolanaProvider(!!provider);
        }
      } catch {
        if (!cancelled) {
          setHasSolanaProvider(false);
        }
      } finally {
        if (timeoutId) {
          window.clearTimeout(timeoutId);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  useEffect(() => {
    let errorShown = false;
    const origError = console.error;
    console.error = (...args) => {
      if (
        typeof args[0] === "string" &&
        args[0].includes("WalletConnectionError: could not get Solana provider")
      ) {
        if (!errorShown) {
          origError(...args);
          errorShown = true;
        }
        return;
      }
      origError(...args);
    };
    return () => {
      console.error = origError;
    };
  }, []);

  return (
    <SolanaProviderContext.Provider value={{ hasSolanaProvider }}>
      {hasSolanaProvider ? (
        <FarcasterSolanaProvider endpoint={endpoint}>
          {children}
        </FarcasterSolanaProvider>
      ) : (
        <>{children}</>
      )}
    </SolanaProviderContext.Provider>
  );
}

export function useHasSolanaProvider() {
  return React.useContext(SolanaProviderContext).hasSolanaProvider;
}
