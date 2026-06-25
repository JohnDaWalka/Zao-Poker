"use client";

import { useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "../Button";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Lightweight wallet-connect UI built directly on wagmi's own hooks.
 *
 * RainbowKit was evaluated but its latest release only supports wagmi v2,
 * while this app runs wagmi v3 — installing it would require forcing
 * incompatible peer deps. This component covers the same connect/disconnect
 * flow using the connectors already configured in WagmiProvider.tsx
 * (Farcaster Frame, Coinbase Wallet, MetaMask, generic injected, WalletConnect).
 */
export function ConnectWallet() {
  const { address, isConnected, connector: activeConnector } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [isOpen, setIsOpen] = useState(false);

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {shortAddress(address)}
          {activeConnector ? ` · ${activeConnector.name}` : ""}
        </span>
        <Button variant="outline" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  if (!isOpen) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setIsOpen(true)}>
        Connect Wallet
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {connectors.map((connector) => (
        <Button
          key={connector.uid}
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => {
            connect({ connector });
            setIsOpen(false);
          }}
        >
          {connector.name}
        </Button>
      ))}
      <button
        type="button"
        className="text-xs text-gray-500 dark:text-gray-400 underline"
        onClick={() => setIsOpen(false)}
      >
        Cancel
      </button>
      {error && (
        <p className="text-xs text-red-500">{error.message}</p>
      )}
    </div>
  );
}
