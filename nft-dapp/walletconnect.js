import { EthereumProvider } from "https://esm.sh/@walletconnect/ethereum-provider@2.17.2";

let wcProvider = null;
let wcInitPromise = null;

function hasProjectId() {
  const cfg = window.CONFIG;
  return cfg?.WALLETCONNECT_PROJECT_ID
    && !cfg.WALLETCONNECT_PROJECT_ID.startsWith("PASTE");
}

function attachWCListeners(p) {
  if (p._yncBound) return;
  p._yncBound = true;
  p.on("connect", () => {
    window.dispatchEvent(new CustomEvent("walletconnect:ready", { detail: { provider: p } }));
  });
  p.on("disconnect", () => {
    window.dispatchEvent(new CustomEvent("walletconnect:disconnected"));
  });
}

async function ensureWCInit() {
  if (!hasProjectId()) return null;
  if (wcProvider) return wcProvider;
  if (wcInitPromise) return wcInitPromise;

  wcInitPromise = EthereumProvider.init({
    projectId: window.CONFIG.WALLETCONNECT_PROJECT_ID,
    chains: [11155111],
    optionalChains: [11155111],
    showQrModal: true,
    rpcMap: {
      11155111: window.CONFIG.SEPOLIA_RPCS[0],
    },
    metadata: {
      name: "idkSomething NFTs",
      description: "YNC NFT collection on Ethereum Sepolia",
      url: window.location.origin,
      icons: [`${window.CONFIG.BASE_URL}/icon-512.svg`],
    },
  }).then(p => {
    wcProvider = p;
    attachWCListeners(p);
    return p;
  }).catch(err => {
    wcInitPromise = null;
    throw err;
  });

  return wcInitPromise;
}

window.getWalletConnectProvider = () => wcProvider;

/** Call when user returns to the browser tab after approving in wallet app. */
window.finishPendingWalletConnect = async function finishPendingWalletConnect() {
  const p = wcProvider || await ensureWCInit().catch(() => null);
  if (!p?.session) return false;

  try {
    if (!p.connected) await p.enable();
  } catch {
    return false;
  }

  if (p.connected && p.accounts?.length) {
    window.dispatchEvent(new CustomEvent("walletconnect:ready", { detail: { provider: p } }));
    return true;
  }
  return false;
};

window.connectViaWalletConnect = async function connectViaWalletConnect() {
  const p = await ensureWCInit();
  if (!p) {
    throw new Error("Set WALLETCONNECT_PROJECT_ID in config.js (free at https://cloud.reown.com)");
  }

  if (p.connected && p.accounts?.length) return p;

  if (!p.connected) await p.connect();

  // Mobile: user may still be in wallet app — session completes when they return
  for (let i = 0; i < 10; i++) {
    if (p.accounts?.length) return p;
    await new Promise(r => setTimeout(r, 300));
  }

  if (p.session) return p;

  throw new Error("Connection not completed. Approve in your wallet, then return to this browser tab.");
};

window.trySilentWalletConnect = async function trySilentWalletConnect() {
  const p = await ensureWCInit();
  if (!p?.session) return null;
  try {
    if (!p.connected) await p.enable();
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

// Resume session when user switches back from wallet app (critical on mobile Safari/Chrome)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    window.finishPendingWalletConnect?.();
  }
});
window.addEventListener("pageshow", () => {
  window.finishPendingWalletConnect?.();
});
