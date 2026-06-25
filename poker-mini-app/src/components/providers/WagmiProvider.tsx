import { createConfig, http, WagmiProvider } from "wagmi";
import { base, degen, mainnet, optimism, unichain, celo } from "wagmi/chains";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { farcasterFrame } from "@farcaster/miniapp-wagmi-connector";
import { coinbaseWallet, metaMask, injected, walletConnect } from 'wagmi/connectors';
import { APP_NAME, APP_ICON_URL, APP_URL } from "~/lib/constants";
import { getPublicEnv } from "~/lib/env";
import { useEffect, useState } from "react";
import { useConnect, useAccount } from "wagmi";
import React from "react";

const { walletConnectProjectId } = getPublicEnv();

// Custom hook for Coinbase Wallet detection and auto-connection
function useCoinbaseWalletAutoConnect() {
  const [isCoinbaseWallet, setIsCoinbaseWallet] = useState(false);
  const { connect, connectors } = useConnect();
  const { isConnected } = useAccount();

  useEffect(() => {
    // Check if we're running in Coinbase Wallet
    const checkCoinbaseWallet = () => {
      const isInCoinbaseWallet = window.ethereum?.isCoinbaseWallet || 
        window.ethereum?.isCoinbaseWalletExtension ||
        window.ethereum?.isCoinbaseWalletBrowser;
      setIsCoinbaseWallet(!!isInCoinbaseWallet);
    };
    
    checkCoinbaseWallet();
    window.addEventListener('ethereum#initialized', checkCoinbaseWallet);
    
    return () => {
      window.removeEventListener('ethereum#initialized', checkCoinbaseWallet);
    };
  }, []);

  useEffect(() => {
    // Auto-connect if in Coinbase Wallet and not already connected
    if (isCoinbaseWallet && !isConnected) {
      connect({ connector: connectors[1] }); // Coinbase Wallet connector
    }
  }, [isCoinbaseWallet, isConnected, connect, connectors]);

  return isCoinbaseWallet;
}

export const config = createConfig({
  chains: [base, optimism, mainnet, degen, unichain, celo],
  transports: {
    [base.id]: http(),
    [optimism.id]: http(),
    [mainnet.id]: http(),
    [degen.id]: http(),
    [unichain.id]: http(),
    [celo.id]: http(),
  },
  connectors: [
    // NOTE: useCoinbaseWalletAutoConnect() below indexes connectors[1] as the
    // Coinbase connector — append new connectors after metaMask, never insert
    // before it, or that auto-connect logic will grab the wrong connector.
    farcasterFrame(),
    coinbaseWallet({
      appName: APP_NAME,
      appLogoUrl: APP_ICON_URL,
      // Adding Privy/ZeroDev's dependency tree pulled in a newer
      // @coinbase/wallet-sdk where `preference` became an object instead of
      // a bare string — same "all" setting, updated shape.
      preference: { options: 'all' },
    }),
    metaMask({
      dappMetadata: {
        name: APP_NAME,
        url: APP_URL,
      },
    }),
    // Generic injected provider: covers Android Chrome / desktop browsers
    // with any EIP-1193 wallet extension that isn't MetaMask or Coinbase.
    injected({ shimDisconnect: true }),
    // WalletConnect only registers when a project ID is configured — without
    // one, wagmi would throw at runtime. Get a free project ID at
    // https://cloud.walletconnect.com and set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID.
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            metadata: {
              name: APP_NAME,
              description: APP_NAME,
              url: APP_URL,
              icons: [APP_ICON_URL],
            },
          }),
        ]
      : []),
  ],
});

const queryClient = new QueryClient();

// Wrapper component that provides Coinbase Wallet auto-connection
function CoinbaseWalletAutoConnect({ children }: { children: React.ReactNode }) {
  useCoinbaseWalletAutoConnect();
  return <>{children}</>;
}

export default function Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <CoinbaseWalletAutoConnect>
          {children}
        </CoinbaseWalletAutoConnect>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
