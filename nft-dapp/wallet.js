/* ─── Wallet session + local profile (localStorage) ─────────────────────── */
const SESSION_KEY = "yncnft_wallet_session";
const PROFILE_KEY = "yncnft_profiles";
const DISCONNECT_KEY = "yncnft_manual_disconnect";

function defaultProfile() {
  return { displayName: "", bio: "", link: "", emoji: "🦊" };
}

function setManualDisconnect(disconnected) {
  if (disconnected) localStorage.setItem(DISCONNECT_KEY, "1");
  else localStorage.removeItem(DISCONNECT_KEY);
}

function isManualDisconnect() {
  return localStorage.getItem(DISCONNECT_KEY) === "1";
}

function saveWalletSession(address) {
  if (!address) return;
  setManualDisconnect(false);
  localStorage.setItem(SESSION_KEY, JSON.stringify({
    address: address.toLowerCase(),
    ts: Date.now(),
  }));
}

function clearWalletSession() {
  localStorage.removeItem(SESSION_KEY);
}

function getWalletSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function getProfile(address) {
  if (!address) return defaultProfile();
  try {
    const all = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    return { ...defaultProfile(), ...(all[address.toLowerCase()] || {}) };
  } catch {
    return defaultProfile();
  }
}

function saveProfileData(address, data) {
  if (!address) return;
  const all = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
  all[address.toLowerCase()] = {
    ...getProfile(address),
    ...data,
    updatedAt: Date.now(),
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
}

function getDisplayName(address, ensName) {
  if (!address) return "Guest";
  const profile = getProfile(address);
  if (profile.displayName?.trim()) return profile.displayName.trim();
  if (ensName) return ensName;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function getProfileEmoji(address) {
  return getProfile(address).emoji || "🦊";
}

async function trySilentConnect() {
  if (!window.ethereum) return null;
  try {
    const accounts = await window.ethereum.request({ method: "eth_accounts" });
    return accounts?.[0] || null;
  } catch {
    return null;
  }
}

function updateGlobalNavWallet() {
  const connectBtn = document.getElementById("navConnectBtn");
  const walletPill = document.getElementById("navWalletPill");
  const walletLabel = document.getElementById("navWalletLabel");
  const walletEmoji = document.getElementById("navWalletEmoji");

  const connected = typeof userAddress !== "undefined" && userAddress && !isManualDisconnect();

  if (connectBtn) connectBtn.classList.toggle("hidden", !!connected);
  if (walletPill) walletPill.classList.toggle("hidden", !connected);

  if (connected && walletLabel) {
    walletLabel.textContent = getDisplayName(userAddress);
    if (typeof resolveENS === "function") {
      resolveENS(userAddress).then(ens => {
        if (ens && walletLabel) walletLabel.textContent = getDisplayName(userAddress, ens);
      });
    }
  }

  if (connected && walletEmoji) {
    walletEmoji.textContent = getProfileEmoji(userAddress);
  }

  if (!connected) {
    document.querySelectorAll("#walletShort, #voteWalletShort, #boardWalletShort, #lotteryWalletShort, #auctionWalletShort").forEach(el => {
      el.textContent = "—";
    });
    return;
  }

  document.querySelectorAll("#walletShort, #voteWalletShort, #boardWalletShort, #lotteryWalletShort, #auctionWalletShort").forEach(el => {
    el.textContent = getDisplayName(userAddress);
    if (typeof resolveENS === "function") {
      resolveENS(userAddress).then(ens => {
        if (ens) el.textContent = getDisplayName(userAddress, ens);
      });
    }
  });
}

function disconnectWallet() {
  setManualDisconnect(true);
  clearWalletSession();

  if (typeof resetWalletState === "function") resetWalletState();

  updateGlobalNavWallet();
  showToast?.("Disconnected. Click Connect to sign in again.");
  window.dispatchEvent(new CustomEvent("wallet:disconnected"));
  renderDisconnectedPages?.();
}
