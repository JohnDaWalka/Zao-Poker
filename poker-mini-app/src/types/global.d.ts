// EIP-1193 injected provider, with the vendor flags this app already checks
// for (Coinbase Wallet detection, Farcaster in-client browser detection).
interface EthereumProvider {
  isCoinbaseWallet?: boolean;
  isCoinbaseWalletExtension?: boolean;
  isCoinbaseWalletBrowser?: boolean;
  isFarcaster?: boolean;
  [key: string]: unknown;
}

interface Window {
  ethereum?: EthereumProvider;
}
