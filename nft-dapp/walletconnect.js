import { EthereumProvider } from "https://esm.sh/@walletconnect/ethereum-provider@2.17.2";

const WC_PENDING_KEY = "ync_wc_pending";

let wcProvider = null;
let wcInitPromise = null;

function hasProjectId() {
  const cfg = window.CONFIG;
  return cfg?.WALLETCONNECT_PROJECT_ID
    && !cfg.WALLETCONNECT_PROJECT_ID.startsWith("PASTE");
}

/** URL wallets should open after the user approves (MetaMask reads redirect.universal). */
function getReturnUrl() {
  const u = new URL(window.location.href);
  u.searchParams.set("wc_return", "1");
  return u.toString();
}

function attachWCListeners(p) {
  if (p._yncBound) return;
  p._yncBound = true;
  p.on("connect", () => {
    sessionStorage.removeItem(WC_PENDING_KEY);
    window.hideWcReturnBanner?.();
    window.dispatchEvent(new CustomEvent("walletconnect:ready", { detail: { provider: p } }));
  });
  p.on("disconnect", () => {
    sessionStorage.removeItem(WC_PENDING_KEY);
    window.hideWcReturnBanner?.();
    window.dispatchEvent(new CustomEvent("walletconnect:disconnected"));
  });
}

async function ensureWCInit() {
  if (!hasProjectId()) return null;
  if (wcProvider) return wcProvider;
  if (wcInitPromise) return wcInitPromise;

  const returnUrl = getReturnUrl();

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
      redirect: {
        native: returnUrl,
        universal: returnUrl,
        linkMode: true,
      },
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

window.getMetaMaskBrowserUrl = function getMetaMaskBrowserUrl() {
  const host = window.location.host + window.location.pathname.replace(/^\//, "");
  return `https://metamask.app.link/dapp/${host}`;
};

window.showWcReturnBanner = function showWcReturnBanner() {
  if (document.getElementById("wcReturnBanner")) return;
  const returnUrl = getReturnUrl();
  const el = document.createElement("div");
  el.id = "wcReturnBanner";
  el.className = "wc-return-banner";
  el.innerHTML = `
    <div class="wc-return-inner">
      <p><strong>Waiting for wallet approval…</strong></p>
      <p class="wc-return-sub">After you tap Connect in your wallet, you should return here automatically. If not, tap below.</p>
      <div class="wc-return-actions">
        <a href="${returnUrl}" class="btn btn-primary btn-sm">Return to site</a>
        <a href="${window.getMetaMaskBrowserUrl()}" class="btn btn-ghost btn-sm">Open in MetaMask browser</a>
      </div>
    </div>
  `;
  document.body.appendChild(el);
};

window.hideWcReturnBanner = function hideWcReturnBanner() {
  document.getElementById("wcReturnBanner")?.remove();
};

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
    sessionStorage.removeItem(WC_PENDING_KEY);
    window.hideWcReturnBanner?.();
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

  sessionStorage.setItem(WC_PENDING_KEY, "1");
  window.showWcReturnBanner?.();

  if (!p.connected) await p.connect();

  for (let i = 0; i < 10; i++) {
    if (p.accounts?.length) {
      sessionStorage.removeItem(WC_PENDING_KEY);
      window.hideWcReturnBanner?.();
      return p;
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (p.session) return p;

  throw new Error("Connection not completed. Approve in your wallet — you should return here automatically.");
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
  sessionStorage.removeItem(WC_PENDING_KEY);
  window.hideWcReturnBanner?.();
  if (wcProvider?.connected) {
    try { await wcProvider.disconnect(); } catch { /* ignore */ }
  }
  wcProvider = null;
  wcInitPromise = null;
};

async function resumeAfterWalletRedirect() {
  const pending = sessionStorage.getItem(WC_PENDING_KEY) === "1"
    || new URLSearchParams(window.location.search).get("wc_return") === "1";
  if (!pending) return;

  const ok = await window.finishPendingWalletConnect();
  if (ok && new URLSearchParams(window.location.search).get("wc_return") === "1") {
    const u = new URL(window.location.href);
    u.searchParams.delete("wc_return");
    history.replaceState({}, "", u.pathname + u.search + u.hash);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    window.finishPendingWalletConnect?.();
  }
});
window.addEventListener("pageshow", () => {
  window.finishPendingWalletConnect?.();
});

resumeAfterWalletRedirect();
