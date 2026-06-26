'use client';

import dynamic from 'next/dynamic';
import { MiniAppProvider } from '@neynar/react';
import { SafeFarcasterSolanaProvider } from '~/components/providers/SafeFarcasterSolanaProvider';
import { RegisterAdapters } from '~/components/providers/RegisterAdapters';
import { PrivyProviders } from '~/components/providers/PrivyProviders';
import { ZeroDevSmartAccountConnector } from '~/components/providers/ZeroDevSmartAccountConnector';
import { ANALYTICS_ENABLED, RETURN_URL, USE_WALLET } from '~/lib/constants';
import { getPublicEnv } from '~/lib/env';

const WagmiProvider = dynamic(
  () => import('~/components/providers/WagmiProvider'),
  {
    ssr: false,
  }
);

export function Providers({
  children,
}: {
  children: React.ReactNode;
}) {
  const solanaEndpoint =
    process.env.SOLANA_RPC_ENDPOINT || 'https://solana-rpc.publicnode.com';

  const { privyAppId, zeroDevBundlerRpc } = getPublicEnv();
  const smartAccountEnabled = Boolean(privyAppId && zeroDevBundlerRpc);
  const appChildren = (
    <>
      <RegisterAdapters />
      {smartAccountEnabled && <ZeroDevSmartAccountConnector />}
      {children}
    </>
  );

  return (
    <PrivyProviders>
      <WagmiProvider>
        <MiniAppProvider
          analyticsEnabled={ANALYTICS_ENABLED}
          backButtonEnabled={true}
          returnUrl={RETURN_URL}
        >
          {USE_WALLET ? (
            <SafeFarcasterSolanaProvider endpoint={solanaEndpoint}>
              {appChildren}
            </SafeFarcasterSolanaProvider>
          ) : (
            appChildren
          )}
        </MiniAppProvider>
      </WagmiProvider>
    </PrivyProviders>
  );
}
