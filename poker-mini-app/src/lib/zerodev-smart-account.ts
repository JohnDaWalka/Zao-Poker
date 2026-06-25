import { http, createPublicClient, type EIP1193Provider } from "viem";
import { base } from "viem/chains";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
  KernelEIP1193Provider,
  type KernelAccountClient,
} from "@zerodev/sdk";
import { getEntryPoint, KERNEL_V3_1 } from "@zerodev/sdk/constants";
import { getPublicEnv } from "./env";

// The Privy embedded-wallet -> smart-account bridge (@privy-io/wagmi's
// useEmbeddedSmartAccountConnector) binds one chain per connector instance.
// Base is this app's primary chain; supporting per-chain smart accounts
// would mean rebuilding the kernel client on every chain switch, which
// wasn't asked for and isn't how this Privy/ZeroDev pattern is normally used.
const SMART_ACCOUNT_CHAIN = base;
const ENTRY_POINT_VERSION = "0.7" as const;

/**
 * Wraps a Privy embedded-wallet signer in a ZeroDev Kernel smart account and
 * returns it as an EIP-1193 provider, so @privy-io/wagmi can register it as
 * a normal wagmi connector. From there, every existing hook that reads
 * wagmi's useAccount()/useChainId() (useUniversalWallet, the EVM chain
 * adapter) works unchanged — a smart account is still just an address.
 *
 * Gas sponsorship is opt-in: without NEXT_PUBLIC_ZERODEV_PAYMASTER_RPC set,
 * the smart account pays its own gas like any other wallet. Configure
 * spending limits in the ZeroDev dashboard before setting that var.
 */
export async function signerToZeroDevSmartAccount({
  signer,
}: {
  signer: EIP1193Provider;
}): Promise<EIP1193Provider> {
  const env = getPublicEnv();

  if (!env.zeroDevBundlerRpc) {
    throw new Error(
      "NEXT_PUBLIC_ZERODEV_BUNDLER_RPC is not set — cannot create a ZeroDev smart account.",
    );
  }

  const entryPoint = getEntryPoint(ENTRY_POINT_VERSION);

  const publicClient = createPublicClient({
    chain: SMART_ACCOUNT_CHAIN,
    transport: http(env.zeroDevBundlerRpc),
  });

  const ecdsaValidator = await signerToEcdsaValidator(publicClient, {
    signer,
    entryPoint,
    kernelVersion: KERNEL_V3_1,
  });

  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: ecdsaValidator },
    entryPoint,
    kernelVersion: KERNEL_V3_1,
  });

  const kernelClient = createKernelAccountClient({
    account: kernelAccount,
    chain: SMART_ACCOUNT_CHAIN,
    bundlerTransport: http(env.zeroDevBundlerRpc),
    client: publicClient,
    // Omitted entirely (rather than passed-but-disabled) when no paymaster
    // RPC is configured, so an unfunded/unconfigured paymaster never blocks
    // a transaction — it just falls back to the account paying its own gas.
    ...(env.zeroDevPaymasterRpc
      ? {
          // Param type is inferred from createKernelAccountClient's own
          // signature — no need to import/restate the UserOperation type.
          paymaster: {
            getPaymasterData: async (userOperation) => {
              const paymasterClient = createZeroDevPaymasterClient({
                chain: SMART_ACCOUNT_CHAIN,
                transport: http(env.zeroDevPaymasterRpc),
              });
              return paymasterClient.sponsorUserOperation({ userOperation });
            },
          },
        }
      : {}),
  }) as KernelAccountClient;

  return new KernelEIP1193Provider(kernelClient) as EIP1193Provider;
}
