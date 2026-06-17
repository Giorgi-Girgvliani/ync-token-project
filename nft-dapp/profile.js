let _profileEmoji = "🦊";

async function initProfilePage() {
  if (!userAddress || !document.getElementById("profilePage")) return;
  if (isManualDisconnect?.()) return;

  document.getElementById("profileNotConnected")?.classList.add("hidden");
  document.getElementById("profileConnected")?.classList.remove("hidden");

  const profile = getProfile(userAddress);
  _profileEmoji = profile.emoji || "🦊";

  document.getElementById("profileAvatar").textContent = _profileEmoji;
  document.getElementById("profileAddress").textContent = userAddress;
  document.getElementById("profileEtherscan").href = `https://sepolia.etherscan.io/address/${userAddress}`;
  document.getElementById("profileEtherscanTop").href = `https://sepolia.etherscan.io/address/${userAddress}`;

  document.getElementById("profileNameInput").value = profile.displayName || "";
  document.getElementById("profileBioInput").value  = profile.bio || "";
  document.getElementById("profileLinkInput").value = profile.link || "";

  const bioEl = document.getElementById("profileBioDisplay");
  if (bioEl) {
    if (profile.bio?.trim()) {
      bioEl.textContent = profile.bio.trim();
      bioEl.classList.remove("hidden");
    } else {
      bioEl.textContent = "";
      bioEl.classList.add("hidden");
    }
  }

  highlightEmoji(_profileEmoji);
  updateProfileHeader(profile);

  const session = getWalletSession();
  const sinceEl = document.getElementById("profileSince");
  if (sinceEl && session?.ts) {
    sinceEl.textContent = new Date(session.ts).toLocaleDateString();
  }

  const ensEl = document.getElementById("profileEns");
  if (ensEl) {
    ensEl.classList.add("hidden");
    ensEl.textContent = "";
  }
  const ens = await resolveENS(userAddress);
  if (ens && ensEl) {
    ensEl.textContent = ens;
    ensEl.classList.remove("hidden");
  }

  await refreshProfileStats();
}

function updateProfileHeader(profile) {
  const name = profile.displayName?.trim() || getDisplayName(userAddress);
  document.getElementById("profileDisplayName").textContent = name;

  const bioEl = document.getElementById("profileBioDisplay");
  if (bioEl) {
    const bio = profile.bio?.trim() || "";
    bioEl.textContent = bio;
    bioEl.classList.toggle("hidden", !bio);
  }

  updateGlobalNavWallet?.();
}

async function refreshProfileStats() {
  if (!provider || !userAddress) return;

  try {
    const ethBal = await provider.getBalance(userAddress);
    document.getElementById("profileEth").textContent =
      parseFloat(ethers.utils.formatEther(ethBal)).toFixed(4);

    if (yncContract) {
      const [raw, dec] = await Promise.all([
        yncContract.balanceOf(userAddress),
        yncContract.decimals(),
      ]);
      document.getElementById("profileYnc").textContent =
        parseFloat(ethers.utils.formatUnits(raw, dec)).toLocaleString(undefined, { maximumFractionDigits: 2 });
    }

    if (nftContract) {
      const bal = await nftContract.balanceOf(userAddress);
      document.getElementById("profileNfts").textContent = bal.toNumber();
    }
  } catch (e) {
    console.error("Profile stats error:", e);
  }
}

function pickEmoji(emoji, btn) {
  _profileEmoji = emoji;
  document.getElementById("profileAvatar").textContent = emoji;
  highlightEmoji(emoji);
}

function highlightEmoji(emoji) {
  document.querySelectorAll(".emoji-btn").forEach(b => {
    b.classList.toggle("active", b.textContent === emoji);
  });
}

function saveUserProfile() {
  if (!userAddress) {
    showToast("Connect wallet first.", "error");
    return;
  }

  const data = {
    displayName: document.getElementById("profileNameInput")?.value.trim() || "",
    bio:         document.getElementById("profileBioInput")?.value.trim() || "",
    link:        document.getElementById("profileLinkInput")?.value.trim() || "",
    emoji:       _profileEmoji,
  };

  saveProfileData(userAddress, data);
  updateProfileHeader(data);
  showToast("Profile saved! ✓");
}

document.addEventListener("DOMContentLoaded", () => {
  if (userAddress && !isManualDisconnect?.()) initProfilePage();
});

window.addEventListener("wallet:connected", () => initProfilePage());

window.addEventListener("wallet:disconnected", () => {
  document.getElementById("profileNotConnected")?.classList.remove("hidden");
  document.getElementById("profileConnected")?.classList.add("hidden");
});
