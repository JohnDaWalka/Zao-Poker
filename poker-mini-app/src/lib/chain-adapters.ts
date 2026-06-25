import type { ChainNamespace } from "~/types/universal";

export type ChainAdapter = {
  namespace: ChainNamespace;
  label: string;
  canSign: boolean;
  canSendTransactions: boolean;
  getAddress: () => Promise<string | null>;
  getChainId?: () => Promise<number | string | null>;
  signMessage?: (message: string) => Promise<string>;
};

const adapterRegistry = new Map<ChainNamespace, ChainAdapter>();

export function registerChainAdapter(adapter: ChainAdapter) {
  adapterRegistry.set(adapter.namespace, adapter);
}

export function getChainAdapter(namespace: ChainNamespace) {
  return adapterRegistry.get(namespace);
}

export function listChainAdapters() {
  return Array.from(adapterRegistry.values());
}
