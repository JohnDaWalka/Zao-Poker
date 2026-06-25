import { getAccount, getChainId, signMessage } from "@wagmi/core";
import { config } from "~/components/providers/WagmiProvider";
import { registerChainAdapter } from "./chain-adapters";

export function registerEvmAdapter() {
  registerChainAdapter({
    namespace: "evm",
    label: "EVM",
    canSign: true,
    canSendTransactions: true,

    async getAddress() {
      return getAccount(config).address ?? null;
    },

    async getChainId() {
      return getChainId(config);
    },

    async signMessage(message: string) {
      return signMessage(config, { message });
    },
  });
}
