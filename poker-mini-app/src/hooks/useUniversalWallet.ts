"use client";

import { useMemo } from "react";
import { useAccount, useChainId } from "wagmi";
import type { UniversalWallet } from "~/types/universal";

export function useUniversalWallet(): UniversalWallet {
  const account = useAccount();
  const chainId = useChainId();

  return useMemo(
    () => ({
      namespace: "evm",
      address: account.address ?? null,
      chainId,
      isConnected: account.isConnected,
      connectorName: account.connector?.name,
    }),
    [account.address, account.connector?.name, account.isConnected, chainId],
  );
}
