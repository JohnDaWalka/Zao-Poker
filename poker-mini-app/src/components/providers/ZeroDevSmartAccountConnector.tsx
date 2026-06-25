"use client";

import { useEmbeddedSmartAccountConnector } from "@privy-io/wagmi";
import { signerToZeroDevSmartAccount } from "~/lib/zerodev-smart-account";

/**
 * Registers the Privy embedded wallet as a ZeroDev smart-account wagmi
 * connector. Per @privy-io/wagmi's own requirement, this must stay mounted
 * inside both PrivyProvider and WagmiProvider for the connector to work.
 * Only ever rendered by providers.tsx when Privy + ZeroDev are both
 * configured — never mounted with a disabled/no-op config.
 */
export function ZeroDevSmartAccountConnector() {
  useEmbeddedSmartAccountConnector({ getSmartAccountFromSigner: signerToZeroDevSmartAccount });
  return null;
}
