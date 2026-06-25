"use client";

import { useAccount, useChainId } from "wagmi";
import type { UniversalWallet } from "~/types/universal";

export function useUniversalWallet(): UniversalWallet {
  const account = useAccount();
  const chainId = useChainId();

  return {
    namespace: "evm",
    address: account.address ?? null,
    chainId,
    isConnected: account.isConnected,
    connectorName: account.connector?.name,
  };
}
