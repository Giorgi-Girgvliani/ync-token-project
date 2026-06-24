import { EthereumProvider } from "https://esm.sh/@walletconnect/ethereum-provider@2.17.2";

let wcProvider = null;
let wcInitPromise = null;

function hasProjectId() {
  return CONFIG.WALLETCONNECT_PROJECT_ID
    && !CONFIG.WALLETCONNECT_PROJECT_ID.startsWith("PASTE");
}

async function ensureWCInit() {
  if (!hasProjectId()) return null;
  if (wcProvider) return wcProvider;
  if (wcInitPromise) return wcInitPromise;

  wcInitPromise = EthereumProvider.init({
    projectId: CONFIG.WALLETCONNECT_PROJECT_ID,
    chains: [11155111],
    optionalChains: [11155111],
    showQrModal: true,
    rpcMap: {
      11155111: CONFIG.SEPOLIA_RPCS[0],
    },
    metadata: {
      name: "idkSomething NFTs",
      description: "YNC NFT collection on Ethereum Sepolia",
      url: CONFIG.BASE_URL,
      icons: [`${CONFIG.BASE_URL}/icon-512.svg`],
    },
  }).then(p => {
    wcProvider = p;
    return p;
  }).catch(err => {
    wcInitPromise = null;
    throw err;
  });

  return wcInitPromise;
}

window.getWalletConnectProvider = () => wcProvider;

window.connectViaWalletConnect = async function connectViaWalletConnect() {
  const p = await ensureWCInit();
  if (!p) {
    throw new Error("Set WALLETCONNECT_PROJECT_ID in config.js (free at https://cloud.reown.com)");
  }
  if (!p.connected) await p.connect();
  return p;
};

window.trySilentWalletConnect = async function trySilentWalletConnect() {
  const p = await ensureWCInit();
  if (!p?.session) return null;
  try {
    await p.enable();
    return p.accounts?.[0] || null;
  } catch {
    return null;
  }
};

window.disconnectWalletConnect = async function disconnectWalletConnect() {
  if (wcProvider?.connected) {
    try { await wcProvider.disconnect(); } catch { /* ignore */ }
  }
  wcProvider = null;
  wcInitPromise = null;
};
