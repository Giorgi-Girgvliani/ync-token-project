/* ─── ABIs ──────────────────────────────────────────────────────────────── */
const NFT_ABI = [
  "function mint() external",
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function name() view returns (string)",
  "event Minted(address indexed to, uint256 tokenId)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
];

/* ─── CORS-friendly public Sepolia RPCs (tried in order) ────────────────── */
const SEPOLIA_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://sepolia.drpc.org",
  "https://rpc2.sepolia.org",
];

async function getReadProvider() {
  if (typeof ethers === "undefined") throw new Error("ethers not loaded");
  for (const url of SEPOLIA_RPCS) {
    try {
      const p = new ethers.providers.JsonRpcProvider(url);
      // Quick liveness check with 4 s timeout
      await Promise.race([
        p.getBlockNumber(),
        new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 4000)),
      ]);
      return p;
    } catch { /* try next */ }
  }
  throw new Error("All Sepolia RPC endpoints unreachable.");
}

/* ─── State ─────────────────────────────────────────────────────────────── */
let provider, signer, userAddress;
let nftContract, yncContract;
let matrixActive = false, matrixRAF;

/* ─── Init ──────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  closeMobileNav();

  // Close mobile nav on link click
  document.querySelectorAll(".nav-link").forEach(l => {
    l.addEventListener("click", closeMobileNav);
  });

  // Auto-reconnect if MetaMask already has an account selected
  if (window.ethereum?.selectedAddress) {
    await connectWallet(true);
  }
});

/* ─── Mobile nav ────────────────────────────────────────────────────────── */
function toggleMenu() {
  const links = document.getElementById("navLinks");
  const btn   = document.getElementById("hamburger");
  if (!links) return;
  const open = links.classList.toggle("open");
  btn?.classList.toggle("open", open);
}

function closeMobileNav() {
  document.getElementById("navLinks")?.classList.remove("open");
  document.getElementById("hamburger")?.classList.remove("open");
}

/* ─── Connect Wallet ────────────────────────────────────────────────────── */
async function connectWallet(silent = false) {
  if (!window.ethereum) {
    if (!silent) alert("MetaMask is not installed. Please install it from metamask.io.");
    return;
  }

  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    userAddress = accounts[0];

    // Ensure Sepolia
    await ensureSepolia();

    // Wire up ethers
    provider = new ethers.providers.Web3Provider(window.ethereum);
    signer   = provider.getSigner();

    // Guard against missing contract address
    if (CONFIG.NFT_CONTRACT === "PASTE_YOUR_NFT_CONTRACT_ADDRESS") {
      showToast("⚠ Paste your NFT contract address in config.js first!", "error");
    } else {
      nftContract = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, signer);
    }
    yncContract = new ethers.Contract(CONFIG.YNC_CONTRACT, ERC20_ABI, provider);

    // Update shared UI
    updateNavWallet();

    // Page-specific logic
    if (document.getElementById("mintPanel"))   await initMintPage();
    if (document.getElementById("galleryGrid")) await initGalleryPage();

    // Listen for account / chain changes
    window.ethereum.removeAllListeners?.("accountsChanged");
    window.ethereum.removeAllListeners?.("chainChanged");
    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());

  } catch (err) {
    if (!silent) {
      if (err.code === 4001) showToast("Connection cancelled.", "error");
      else alert("Connection error: " + (err.message || err));
    }
  }
}

async function ensureSepolia() {
  const chainId = await window.ethereum.request({ method: "eth_chainId" });
  if (chainId.toLowerCase() === CONFIG.SEPOLIA_CHAIN_ID) return;

  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CONFIG.SEPOLIA_CHAIN_ID }],
    });
  } catch (err) {
    if (err.code === 4902) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: CONFIG.SEPOLIA_CHAIN_ID,
          chainName: "Sepolia Testnet",
          nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
          blockExplorerUrls: ["https://sepolia.etherscan.io"],
        }],
      });
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CONFIG.SEPOLIA_CHAIN_ID }],
      });
    } else {
      throw err;
    }
  }
}

async function updateNavWallet() {
  const walletShort = document.getElementById("walletShort");
  if (!walletShort) return;
  walletShort.textContent = `${userAddress.slice(0,6)}…${userAddress.slice(-4)}`;
  // Try ENS
  const ens = await resolveENS(userAddress);
  if (ens) walletShort.textContent = ens;
}

/* ─── Mint Page ─────────────────────────────────────────────────────────── */
async function initMintPage() {
  const notConn  = document.getElementById("notConnected");
  const mintPanel = document.getElementById("mintPanel");

  if (notConn)   notConn.classList.add("hidden");
  if (mintPanel) mintPanel.classList.remove("hidden");

  await refreshMintPage();
}

async function refreshMintPage() {
  if (!provider || !userAddress) return;

  try {
    // ETH balance
    const ethBal = await provider.getBalance(userAddress);
    const ethEl  = document.getElementById("ethBalance");
    if (ethEl) ethEl.textContent = parseFloat(ethers.utils.formatEther(ethBal)).toFixed(4);

    // YNC balance
    if (yncContract) {
      const [yncRaw, yncDec] = await Promise.all([
        yncContract.balanceOf(userAddress),
        yncContract.decimals(),
      ]);
      const yncEl = document.getElementById("yncBalance");
      if (yncEl) yncEl.textContent = parseFloat(ethers.utils.formatUnits(yncRaw, yncDec)).toLocaleString(undefined,{maximumFractionDigits:2});
    }

    // Supply bar
    if (nftContract) {
      const supply   = await nftContract.totalSupply();
      const maxSup   = CONFIG.MAX_SUPPLY;
      const minted   = supply.toNumber();
      const mintedEl = document.getElementById("minted");
      const maxEl    = document.getElementById("maxSupply");
      const fill     = document.getElementById("supplyFill");
      if (mintedEl) mintedEl.textContent = minted;
      if (maxEl)    maxEl.textContent    = maxSup;
      if (fill)     fill.style.width     = `${(minted / maxSup) * 100}%`;

      updateCountdown(minted);

      // Disable mint if sold out
      const mintBtn = document.getElementById("mintBtn");
      if (mintBtn && minted >= maxSup) {
        mintBtn.textContent = "Sold Out";
        mintBtn.disabled    = true;
      }
    }
  } catch (err) {
    console.error("refreshMintPage error:", err);
  }
}

async function mint() {
  if (!nftContract) {
    showToast("Deploy your contract first and add address to config.js", "error");
    return;
  }

  const btn = document.getElementById("mintBtn");
  if (!btn) return;

  btn.disabled = true;
  btn.innerHTML = `<div class="spinner" style="width:18px;height:18px;margin:0"></div> Minting…`;

  try {
    const tx      = await nftContract.mint();
    showToast("Transaction sent! Waiting for confirmation…");

    const receipt = await tx.wait();
    const tokenId = receipt.events?.find(e => e.event === "Minted")?.args?.tokenId?.toNumber()
                    ?? "?";

    showToast(`Minted NFT #${tokenId}! 🎉`);
    launchConfetti();
    playMintSound();
    showReceiptModal(tokenId, tx.hash, receipt.gasUsed?.toString() || "~45000", receipt.blockNumber);
    openEtherscan(tx.hash);
    refreshActivity();

    await refreshMintPage();

    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg> Minted!`;
    setTimeout(() => {
      btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Mint Free NFT`;
      btn.disabled = false;
    }, 3000);

  } catch (err) {
    console.error("Mint error:", err);
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Mint Free NFT`;
    btn.disabled  = false;

    if (err.code === 4001)         showToast("Mint cancelled.", "error");
    else if (err.reason)           showToast("Error: " + err.reason, "error");
    else                           showToast("Mint failed. Check console.", "error");
  }
}

/* ─── Gallery Page ──────────────────────────────────────────────────────── */
async function initGalleryPage() {
  document.getElementById("galleryNotConnected")?.classList.add("hidden");
  try {
    await loadGallery(true);
  } catch (err) {
    console.error("Gallery error:", err);
    document.getElementById("galleryLoading")?.classList.add("hidden");
    showToast("Error loading gallery. Check console.", "error");
  }
}

async function loadGallery(showSkeleton = false) {
  const loading = document.getElementById("galleryLoading");
  const grid    = document.getElementById("galleryGrid");
  const empty   = document.getElementById("galleryEmpty");
  const stats   = document.getElementById("galleryStats");

  if (showSkeleton) loading?.classList.remove("hidden");
  else loading?.classList.add("hidden");

  if (!nftContract) {
    loading?.classList.add("hidden");
    if (grid) grid.classList.add("hidden");
    if (empty) {
      empty.classList.remove("hidden");
      if (CONFIG.NFT_CONTRACT === "PASTE_YOUR_NFT_CONTRACT_ADDRESS") {
        empty.querySelector("h2").textContent = "Contract not configured";
        empty.querySelector("p").textContent  = "Paste your NFT contract address in config.js";
      } else {
        empty.querySelector("h2").textContent = "Wallet not connected";
        empty.querySelector("p").textContent  = "Connect MetaMask to view your idkSomething NFTs.";
      }
    }
    return;
  }

  const balance = await nftContract.balanceOf(userAddress);
  const count   = balance.toNumber();

  loading?.classList.add("hidden");

  // YNC for stats bar
  let yncDisplay = "0";
  if (yncContract) {
    try {
      const [r, d] = await Promise.all([yncContract.balanceOf(userAddress), yncContract.decimals()]);
      yncDisplay = parseFloat(ethers.utils.formatUnits(r, d)).toLocaleString(undefined,{maximumFractionDigits:2});
    } catch {}
  }

  // Show stats bar
  if (stats) {
    stats.classList.remove("hidden");
    const ownedEl = document.getElementById("ownedCount");
    const yncEl   = document.getElementById("galleryYNC");
    if (ownedEl) ownedEl.textContent = count;
    if (yncEl)   yncEl.textContent   = yncDisplay;
  }

  if (count === 0) {
    empty?.classList.remove("hidden");
    return;
  }

  // Fetch token IDs
  const tokenIds = [];
  for (let i = 0; i < count; i++) {
    const id = await nftContract.tokenOfOwnerByIndex(userAddress, i);
    tokenIds.push(id.toNumber());
  }

  // Render cards
  if (grid) {
    grid.innerHTML = "";
    grid.classList.remove("hidden");

    const rarities  = ["", "Common", "Common", "Uncommon", "Rare", "Legendary"];
    const names     = ["", "The Void", "The Silence", "Pure Vibes", "The Matrix", "Legendary Nothing"];
    const rarityClass = ["", "common", "common", "uncommon", "rare", "legendary"];

    for (const id of tokenIds) {
      const imgSrc = `${CONFIG.BASE_URL}/images/${id}.svg`;
      const esLink = `https://sepolia.etherscan.io/token/${CONFIG.NFT_CONTRACT}?a=${userAddress}`;

      const card = document.createElement("div");
      card.className = "nft-card";
      card.innerHTML = `
        <img src="images/${id}.svg" alt="NFT #${id}" onerror="this.src='images/1.svg'" loading="lazy"/>
        <div class="nft-card-body">
          <div class="nft-card-name">idkSomething NFT #${id}</div>
          <div class="nft-card-id">Token ID: ${id} · YNCNFT</div>
          <div class="nft-card-traits">
            <span class="nft-trait rarity ${rarityClass[id] || 'common'}">${rarities[id] || 'Common'}</span>
            <span class="nft-trait">${names[id] || 'The Void'}</span>
            <span class="nft-trait">Utility: None</span>
          </div>
          <a href="${esLink}" target="_blank" rel="noopener noreferrer" class="nft-etherscan">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            View on Etherscan
          </a>
        </div>
      `;
      card.querySelector("img").addEventListener("click", () => openPreview(id));
      grid.appendChild(card);
    }
  }
}

/* ─── Lightbox ──────────────────────────────────────────────────────────── */
function openPreview(id) {
  const lb  = document.getElementById("lightbox");
  const img = document.getElementById("lightboxImg");
  if (!lb || !img) return;
  img.src = `images/${id}.svg`;
  img.alt = `NFT #${id}`;
  lb.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeLightbox() {
  document.getElementById("lightbox")?.classList.add("hidden");
  document.body.style.overflow = "";
}

// Close any open modal / overlay on Escape
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if (matrixActive) { stopMatrix(); return; }
  closeLightbox();
  document.getElementById("nftModal")?.classList.add("hidden");
  document.getElementById("receiptModal")?.classList.add("hidden");
  if (document.body.style.overflow === "hidden") document.body.style.overflow = "";
});

/* ─── Etherscan link helper ─────────────────────────────────────────────── */
function openEtherscan(hash) {
  window.open(`https://sepolia.etherscan.io/tx/${hash}`, "_blank", "noopener,noreferrer");
}

/* ─── Toast ─────────────────────────────────────────────────────────────── */
function showToast(msg, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.remove("hidden", "error");
  if (type === "error") toast.classList.add("error");
  requestAnimationFrame(() => toast.classList.add("show"));
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => { toast.classList.add("hidden"); toast.classList.remove("error"); }, 350);
  }, type === "error" ? 4000 : 2500);
}

/* ─── Typewriter ────────────────────────────────────────────────────────── */
(function typewriter() {
  const el = document.getElementById("heroSub");
  if (!el) return;
  const text = "5 unique ERC-721 tokens that do absolutely nothing.\nImmutably recorded on Ethereum. Permanently pointless.";
  let i = 0;
  function tick() {
    if (i > text.length) return;
    el.innerHTML = text.slice(0, i).replace(/\n/g, "<br/>") + (i < text.length ? '<span class="cursor-blink">|</span>' : "");
    i++;
    setTimeout(tick, i < text.length ? 28 : 0);
  }
  setTimeout(tick, 600);
})();

/* ─── Scroll reveal ─────────────────────────────────────────────────────── */
(function scrollReveal() {
  const els = document.querySelectorAll(".reveal");
  if (!els.length) return;
  const obs = new IntersectionObserver((entries) => {
    entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("visible"); obs.unobserve(e.target); } });
  }, { threshold: 0.12 });
  els.forEach(el => obs.observe(el));
})();

/* ─── 3D tilt on cards ──────────────────────────────────────────────────── */
(function initTilt() {
  function applyTilt(card) {
    card.addEventListener("mousemove", e => {
      const r    = card.getBoundingClientRect();
      const x    = e.clientX - r.left - r.width  / 2;
      const y    = e.clientY - r.top  - r.height / 2;
      const rotX = -(y / (r.height / 2)) * 8;
      const rotY =  (x / (r.width  / 2)) * 8;
      card.style.transform = `perspective(600px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.03)`;
    });
    card.addEventListener("mouseleave", () => {
      card.style.transform = "";
    });
  }
  document.querySelectorAll(".tilt-card").forEach(applyTilt);
})();

/* Add cursor blink style */
if (!document.getElementById("cursor-blink-style")) {
  const s = document.createElement("style");
  s.id = "cursor-blink-style";
  s.textContent = `.cursor-blink { animation: cb 0.8s step-end infinite; } @keyframes cb { 0%,100%{opacity:1} 50%{opacity:0} }`;
  document.head.appendChild(s);
}

/* ─── Fix confetti (physics-based, truly random directions) ─────────────── */
function launchConfetti() {
  const colors = ["#a78bfa","#ec4899","#06b6d4","#fbbf24","#34d399","#f472b6"];
  for (let i = 0; i < 80; i++) {
    const dot  = document.createElement("div");
    const size = 4 + Math.random() * 7;
    const x    = window.innerWidth  * (0.25 + Math.random() * 0.5);
    const y    = window.innerHeight * 0.5;
    const vx   = (Math.random() - 0.5) * 500;
    const vy   = -(180 + Math.random() * 320);
    const color = colors[Math.floor(Math.random() * colors.length)];
    dot.style.cssText = `position:fixed;z-index:9999;pointer-events:none;border-radius:50%;
      width:${size}px;height:${size}px;background:${color};left:${x}px;top:${y}px;`;
    document.body.appendChild(dot);
    const start = performance.now();
    (function animate(now) {
      const t = (now - start) / 1000;
      const nx = x + vx * t;
      const ny = y + vy * t + 0.5 * 500 * t * t;
      const op = Math.max(0, 1 - t * 0.65);
      dot.style.left    = nx + "px";
      dot.style.top     = ny + "px";
      dot.style.opacity = op;
      if (op > 0) requestAnimationFrame(animate);
      else dot.remove();
    })(start);
  }
}

/* ─── Dark mode ─────────────────────────────────────────────────────────── */
function toggleDarkMode() {
  const html   = document.documentElement;
  const isDark = html.getAttribute("data-theme") === "dark";
  const next   = isDark ? "light" : "dark";
  html.setAttribute("data-theme", next);
  const icon = document.getElementById("darkModeIcon");
  if (icon) icon.textContent = isDark ? "🌙" : "☀️";
  localStorage.setItem("ync-theme", next);
}

(function applyStoredTheme() {
  const saved = localStorage.getItem("ync-theme");
  if (saved) {
    document.documentElement.setAttribute("data-theme", saved);
    const icon = document.getElementById("darkModeIcon");
    if (icon) icon.textContent = saved === "light" ? "🌙" : "☀️";
  }
})();

/* ─── Gas tracker ───────────────────────────────────────────────────────── */
async function updateGasPrice() {
  const el = document.getElementById("gasPrice");
  if (!el || typeof ethers === "undefined") return;
  try {
    const p    = await getReadProvider();
    const gas  = await p.getGasPrice();
    const gwei = parseFloat(ethers.utils.formatUnits(gas, "gwei")).toFixed(1);
    el.textContent = gwei;
  } catch { el.textContent = "—"; }
}
updateGasPrice();
setInterval(updateGasPrice, 30000);

/* ─── ENS resolver ──────────────────────────────────────────────────────── */
async function resolveENS(address) {
  if (typeof ethers === "undefined") return null;
  try {
    // ENS only works on mainnet — use a CORS-friendly mainnet endpoint
    const mainnet = new ethers.providers.JsonRpcProvider("https://ethereum-rpc.publicnode.com");
    const name = await mainnet.lookupAddress(address);
    return name || null;
  } catch { return null; }
}

/* ─── Add YNC to MetaMask ───────────────────────────────────────────────── */
async function addYNCToMetaMask() {
  if (!window.ethereum) { showToast("MetaMask not detected.", "error"); return; }
  try {
    // Read the actual on-chain symbol so it matches what MetaMask expects
    let symbol = "YNC";
    try {
      const p   = await getReadProvider();
      const con = new ethers.Contract(CONFIG.YNC_CONTRACT, ERC20_ABI, p);
      symbol    = await con.symbol();
    } catch { /* fall back to "YNC" */ }

    await window.ethereum.request({
      method: "wallet_watchAsset",
      params: {
        type: "ERC20",
        options: {
          address:  CONFIG.YNC_CONTRACT,
          symbol:   symbol,
          decimals: 18,
          image:    CONFIG.BASE_URL + "/images/1.svg",
        },
      },
    });
    showToast(`${symbol} token added to MetaMask!`);
  } catch (e) { showToast("Could not add token: " + e.message, "error"); }
}

/* ─── Live activity feed ────────────────────────────────────────────────── */
const NFT_NAMES = {1:"The Void",2:"The Silence",3:"Pure Vibes",4:"The Matrix",5:"Legendary Nothing"};
const NFT_EMOJIS = {1:"🌌",2:"🔷",3:"💗",4:"💚",5:"👑"};

async function refreshActivity() {
  const feed = document.getElementById("activityFeed");
  if (!feed || typeof ethers === "undefined") return;
  if (CONFIG.NFT_CONTRACT === "PASTE_YOUR_NFT_CONTRACT_ADDRESS") {
    feed.innerHTML = `<div class="activity-empty">Set NFT contract in config.js to see live activity.</div>`;
    return;
  }
  try {
    const p    = await getReadProvider();
    const con  = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, p);
    const ZERO = "0x0000000000000000000000000000000000000000";

    // Use Transfer events: from=0x0 means mint, otherwise a transfer
    const events = await con.queryFilter(con.filters.Transfer(), -10000);

    if (!events.length) {
      feed.innerHTML = `<div class="activity-empty">No mints yet. Be the first!</div>`;
      return;
    }

    feed.innerHTML = "";
    const reversed = [...events].reverse().slice(0, 10);
    for (const ev of reversed) {
      const from    = ev.args.from.toLowerCase();
      const to      = ev.args.to;
      const tokenId = ev.args.tokenId.toNumber();
      const isMint  = from === ZERO;
      const short   = `${to.slice(0,6)}…${to.slice(-4)}`;
      const block   = await p.getBlock(ev.blockNumber);
      const time    = block ? new Date(block.timestamp * 1000).toLocaleTimeString() : "";
      const action  = isMint ? "minted" : "received";
      const color   = isMint
        ? "linear-gradient(135deg,#7c3aed,#ec4899)"
        : "linear-gradient(135deg,#0891b2,#10b981)";

      const item = document.createElement("div");
      item.className = "activity-item";
      item.innerHTML = `
        <div class="activity-avatar" style="background:${color}">${NFT_EMOJIS[tokenId]||"🎨"}</div>
        <div class="activity-text">
          <span class="activity-addr">${short}</span>
          <strong> ${action} #${tokenId} — ${NFT_NAMES[tokenId]||"?"}</strong>
        </div>
        <span class="activity-time">${time}</span>
      `;
      feed.appendChild(item);
    }
  } catch (e) {
    feed.innerHTML = `<div class="activity-empty">Could not load activity. Check connection.</div>`;
  }
}
setTimeout(refreshActivity, 2000);
setInterval(refreshActivity, 30000);

/* ─── Animated stats counter ────────────────────────────────────────────── */
(function initStatsCounter() {
  const nums = document.querySelectorAll(".stat-num[data-target]");
  if (!nums.length) return;
  const obs = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const el     = e.target;
      const target = parseInt(el.dataset.target);
      const suffix = el.dataset.suffix || "";
      const dur    = 1200;
      const start  = performance.now();
      (function tick(now) {
        const p = Math.min((now - start) / dur, 1);
        const ease = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(ease * target) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(start);
      obs.unobserve(el);
    });
  }, { threshold: 0.5 });
  nums.forEach(n => obs.observe(n));
})();

/* ─── Countdown dots ────────────────────────────────────────────────────── */
function updateCountdown(minted) {
  const numEl  = document.getElementById("remainingCount");
  const dotsEl = document.getElementById("countdownDots");
  if (!numEl || !dotsEl) return;
  const max  = CONFIG.MAX_SUPPLY;
  const left = Math.max(0, max - minted);
  numEl.textContent = left;
  dotsEl.innerHTML  = "";
  for (let i = 0; i < max; i++) {
    const d = document.createElement("div");
    d.className = "countdown-dot" + (i < minted ? " minted" : "");
    dotsEl.appendChild(d);
  }
}

/* ─── Rarity filter ─────────────────────────────────────────────────────── */
function filterRarity(rarity, btn) {
  document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll("#collectionGrid .preview-card").forEach(card => {
    const r = card.dataset.rarity;
    card.classList.toggle("filtered", rarity !== "all" && r !== rarity);
  });
}

/* ─── NFT detail modal data ─────────────────────────────────────────────── */
const NFT_DATA = {
  1: { name:"idkSomething NFT #1 — The Void",       desc:"A swirling purple void. Does nothing. Beautifully.", rarity:"Common",    rarityClass:"common",    vibeScore:42,  bg:"Void",       aura:"Purple" },
  2: { name:"idkSomething NFT #2 — The Silence",    desc:"Crystalline cyan hexagons. Geometrically perfect, functionally useless.", rarity:"Common",    rarityClass:"common",    vibeScore:55,  bg:"Deep Space", aura:"Cyan" },
  3: { name:"idkSomething NFT #3 — Pure Vibes",     desc:"Pink waves radiating pure vibes. It does not do anything.",              rarity:"Uncommon",  rarityClass:"uncommon",  vibeScore:77,  bg:"Dusk",       aura:"Pink" },
  4: { name:"idkSomething NFT #4 — The Matrix",     desc:"Green data cascading into the void. 01001110.",                          rarity:"Rare",      rarityClass:"rare",      vibeScore:88,  bg:"Matrix",     aura:"Green" },
  5: { name:"idkSomething NFT #5 — Legendary Nothing", desc:"The crown jewel. Nothing, but legendary.",                           rarity:"Legendary", rarityClass:"legendary", vibeScore:100, bg:"Cosmos",     aura:"Gold" },
};

function openNFTModal(id) {
  if (id === 4) { triggerMatrixRain(); return; } // Easter egg on #4
  const d    = NFT_DATA[id];
  const modal = document.getElementById("nftModal");
  if (!modal || !d) return;

  document.getElementById("modalImg").src = `images/${id}.svg`;
  document.getElementById("modalTitle").textContent = d.name;
  document.getElementById("modalDesc").textContent  = d.desc;
  document.getElementById("modalRarityBadge").innerHTML = `<span class="rarity ${d.rarityClass}">${d.rarity}</span>`;
  document.getElementById("modalEtherscan").href =
    CONFIG.NFT_CONTRACT !== "PASTE_YOUR_NFT_CONTRACT_ADDRESS"
      ? `https://sepolia.etherscan.io/token/${CONFIG.NFT_CONTRACT}`
      : "#";

  const traits = document.getElementById("modalTraits");
  traits.innerHTML = [
    { name:"Vibe Score",  value:`${d.vibeScore}/100`, pct: d.vibeScore },
    { name:"Nothingness", value:"100%",               pct: 100 },
    { name:"Background",  value: d.bg,                pct: null },
    { name:"Aura",        value: d.aura,              pct: null },
    { name:"Utility",     value:"None",               pct: null },
  ].map(t => `
    <div class="trait-row">
      <div class="trait-header"><span class="trait-name">${t.name}</span><span class="trait-value">${t.value}</span></div>
      ${t.pct !== null ? `<div class="trait-bar-bg"><div class="trait-bar-fill" style="width:0%" data-pct="${t.pct}"></div></div>` : ""}
    </div>
  `).join("");

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";

  // Animate trait bars after render
  requestAnimationFrame(() => {
    modal.querySelectorAll(".trait-bar-fill").forEach(b => {
      b.style.width = b.dataset.pct + "%";
    });
  });
}

function closeNFTModal(e) {
  if (e && e.target !== document.getElementById("nftModal")) return;
  document.getElementById("nftModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─── TX Receipt modal ──────────────────────────────────────────────────── */
let _lastMintedId = null;
let _lastTxHash   = null;

function showReceiptModal(tokenId, txHash, gasUsed, blockNum) {
  _lastMintedId = tokenId;
  _lastTxHash   = txHash;
  const modal = document.getElementById("receiptModal");
  if (!modal) return;
  const body = document.getElementById("receiptBody");
  body.innerHTML = [
    { label:"Token ID",    value:`#${tokenId} — ${NFT_NAMES[tokenId]||"NFT"}` },
    { label:"Tx Hash",     value:`${txHash.slice(0,10)}…${txHash.slice(-6)}` },
    { label:"Block",       value:`#${blockNum}` },
    { label:"Gas Used",    value:`${parseInt(gasUsed).toLocaleString()} units` },
    { label:"Network",     value:"Sepolia Testnet" },
    { label:"Standard",    value:"ERC-721" },
  ].map(r => `
    <div class="receipt-row">
      <span class="receipt-row-label">${r.label}</span>
      <span class="receipt-row-value">${r.value}</span>
    </div>`).join("");
  document.getElementById("receiptEtherscan").href = `https://sepolia.etherscan.io/tx/${txHash}`;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeReceiptModal(e) {
  if (e && e.target !== document.getElementById("receiptModal")) return;
  document.getElementById("receiptModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─── Share on X ────────────────────────────────────────────────────────── */
function shareOnX() {
  const id   = _lastMintedId || "?";
  const name = NFT_NAMES[id] || "an NFT";
  const text = `Just minted idkSomething NFT #${id} — "${name}" on Ethereum Sepolia 🎉\n\nIt does absolutely nothing. That's the whole point.\n\n${CONFIG.BASE_URL}\n\n#NFT #ERC721 #Web3 #YNC`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
}

/* ─── Ownership checker ─────────────────────────────────────────────────── */
async function checkOwnership() {
  const input  = document.getElementById("ownershipInput");
  const result = document.getElementById("ownershipResult");
  if (!input || !result || typeof ethers === "undefined") return;

  const addr = input.value.trim();
  if (!addr || (!addr.startsWith("0x") && !addr.endsWith(".eth"))) {
    showToast("Enter a valid 0x address.", "error"); return;
  }

  if (CONFIG.NFT_CONTRACT === "PASTE_YOUR_NFT_CONTRACT_ADDRESS") {
    showToast("Set NFT contract in config.js first.", "error"); return;
  }

  result.classList.remove("hidden");
  result.innerHTML = `<div class="skeleton skeleton-line" style="width:60%;margin-bottom:8px"></div><div class="skeleton skeleton-line short"></div>`;

  try {
    const p   = await getReadProvider();
    let resolved = addr;
    if (addr.endsWith(".eth")) {
      resolved = await p.resolveName(addr);
      if (!resolved) { result.innerHTML = `<p style="color:var(--text-muted)">ENS name not found.</p>`; return; }
    }
    const con  = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, p);
    const bal  = await con.balanceOf(resolved);
    const count = bal.toNumber();

    if (count === 0) {
      result.innerHTML = `<p><strong>${addr.slice(0,10)}…</strong> owns <strong>0</strong> idkSomething NFTs.</p>`;
      return;
    }
    const ids = [];
    for (let i = 0; i < count; i++) {
      const tid = await con.tokenOfOwnerByIndex(resolved, i);
      ids.push(tid.toNumber());
    }
    result.innerHTML = `
      <p style="margin-bottom:12px"><strong>${addr.slice(0,10)}…</strong> owns <strong style="color:var(--purple-light)">${count}</strong> idkSomething NFT${count>1?"s":""}:</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${ids.map(id=>`<span class="nft-trait">#${id} — ${NFT_NAMES[id]||"?"}</span>`).join("")}
      </div>`;
  } catch (e) {
    result.innerHTML = `<p style="color:var(--pink)">Error: ${e.message}</p>`;
  }
}

/* ─── Matrix rain easter egg (NFT #4) ───────────────────────────────────── */

function triggerMatrixRain() {
  const canvas = document.getElementById("matrixCanvas");
  if (!canvas) return;
  if (matrixActive) { stopMatrix(); return; }

  matrixActive = true;
  canvas.classList.remove("hidden");
  showToast("You found the Matrix Easter Egg! Click anywhere to exit.", "success");

  const ctx = canvas.getContext("2d");
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;

  const cols    = Math.floor(canvas.width / 16);
  const drops   = Array(cols).fill(1);
  const chars   = "01アイウエオカキクケコYNCアbcdイefgh01ウエオ";

  function draw() {
    ctx.fillStyle = "rgba(0,0,0,0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#10b981";
    ctx.font      = "14px 'Courier New', monospace";
    drops.forEach((y, i) => {
      const char = chars[Math.floor(Math.random() * chars.length)];
      ctx.fillStyle = y === 1 ? "#6ee7b7" : "#10b981";
      ctx.fillText(char, i * 16, y * 16);
      if (y * 16 > canvas.height && Math.random() > 0.975) drops[i] = 0;
      drops[i]++;
    });
    matrixRAF = requestAnimationFrame(draw);
  }
  draw();

  canvas.onclick = stopMatrix;
}

function stopMatrix() {
  matrixActive = false;
  cancelAnimationFrame(matrixRAF);
  const canvas = document.getElementById("matrixCanvas");
  if (canvas) { canvas.classList.add("hidden"); canvas.onclick = null; }
}

/* ─── Konami code easter egg ────────────────────────────────────────────── */
(function konamiCode() {
  const seq  = [38,38,40,40,37,39,37,39,66,65]; // ↑↑↓↓←→←→BA
  let   pos  = 0;
  document.addEventListener("keydown", e => {
    if (e.keyCode === seq[pos]) {
      pos++;
      if (pos === seq.length) {
        pos = 0;
        konamiActivate();
      }
    } else { pos = 0; }
  });
})();

function konamiActivate() {
  launchConfetti();
  launchConfetti();
  showToast("🎮 KONAMI CODE ACTIVATED — 200% VIBES UNLOCKED");
  // Briefly spin the entire page
  document.body.style.transition = "transform 0.5s ease";
  document.body.style.transform  = "rotate(360deg)";
  setTimeout(() => {
    document.body.style.transform  = "";
    document.body.style.transition = "";
  }, 500);
}

/* ─── Logo click easter egg (5×) ───────────────────────────────────────── */
(function logoClicks() {
  const logo = document.getElementById("navLogo");
  if (!logo) return;
  let clicks = 0, timer;
  logo.addEventListener("click", e => {
    e.preventDefault();
    clicks++;
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 2000);
    if (clicks >= 5) {
      clicks = 0;
      logoSecret();
    }
  });
})();

function logoSecret() {
  launchConfetti();
  showToast("🤫 Secret unlocked: This was made for a uni assignment. shhh.");
  const logo = document.getElementById("navLogo");
  if (logo) {
    logo.style.transition = "transform 0.3s";
    logo.style.transform  = "scale(1.5)";
    setTimeout(() => { logo.style.transform = ""; }, 400);
  }
}

/* ─── Cursor trail ──────────────────────────────────────────────────────── */
(function cursorTrail() {
  const container = document.getElementById("cursorTrail");
  if (!container || window.matchMedia("(pointer: coarse)").matches) return;
  const COLORS = ["#a78bfa","#ec4899","#06b6d4","#fbbf24"];
  let tick = 0;
  document.addEventListener("mousemove", e => {
    if (tick++ % 3 !== 0) return; // throttle
    const dot  = document.createElement("div");
    const size = 6 + Math.random() * 6;
    dot.className = "cursor-dot";
    dot.style.cssText = `width:${size}px;height:${size}px;
      background:${COLORS[Math.floor(Math.random()*COLORS.length)]};
      left:${e.clientX}px;top:${e.clientY}px;opacity:0.7;`;
    container.appendChild(dot);
    setTimeout(() => dot.remove(), 600);
  });
})();

/* ─── Holographic foil (mouse tracking) ─────────────────────────────────── */
(function holoFoil() {
  document.querySelectorAll(".holo-card").forEach(card => {
    card.addEventListener("mousemove", e => {
      const overlay = card.querySelector(".holo-overlay");
      if (!overlay) return;
      const r  = card.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width)  * 100;
      const py = ((e.clientY - r.top)  / r.height) * 100;
      overlay.style.backgroundPosition = `${px}% ${py}%`;
      overlay.style.opacity = "1";
    });
    card.addEventListener("mouseleave", () => {
      const overlay = card.querySelector(".holo-overlay");
      if (overlay) overlay.style.opacity = "0.3";
    });
  });
})();

/* ─── Sound effects (Web Audio API) ─────────────────────────────────────── */
function playMintSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch {}
}

/* ─── FAQ toggle ────────────────────────────────────────────────────────── */
function toggleFaq(btn) {
  const answer = btn.nextElementSibling;
  const isOpen = answer.classList.contains("open");
  // Close all
  document.querySelectorAll(".faq-a.open").forEach(a => a.classList.remove("open"));
  document.querySelectorAll(".faq-q.open").forEach(q => q.classList.remove("open"));
  if (!isOpen) {
    answer.classList.add("open");
    btn.classList.add("open");
  }
}

/* ─── Leaderboard ───────────────────────────────────────────────────────── */
async function loadLeaderboard() {
  const el = document.getElementById("leaderboard");
  if (!el || typeof ethers === "undefined") return;
  if (CONFIG.NFT_CONTRACT === "PASTE_YOUR_NFT_CONTRACT_ADDRESS") {
    el.innerHTML = `<div class="activity-empty">Set NFT contract in config.js first.</div>`; return;
  }
  el.innerHTML = `<div style="display:flex;gap:12px">
    <div class="skeleton skeleton-card" style="height:56px;flex:1"></div>
    <div class="skeleton skeleton-card" style="height:56px;flex:1"></div>
  </div>`;
  try {
    const p   = await getReadProvider();
    const con = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_ABI, p);
    const sup = await con.totalSupply();
    const total = sup.toNumber();
    if (!total) { el.innerHTML = `<div class="activity-empty">No NFTs minted yet.</div>`; return; }

    // Build owner map from Transfer events (accurate after transfers/sales)
    // Mint = Transfer from 0x0; transfer out decrements the sender
    const ownerMap = {};
    const ZERO = "0x0000000000000000000000000000000000000000";
    const events = await con.queryFilter(con.filters.Transfer(), -50000);
    events.forEach(ev => {
      const from = ev.args.from.toLowerCase();
      const to   = ev.args.to.toLowerCase();
      if (from !== ZERO) ownerMap[from] = Math.max(0, (ownerMap[from] || 0) - 1);
      if (to   !== ZERO) ownerMap[to]   = (ownerMap[to]   || 0) + 1;
    });
    // Remove addresses with 0 tokens
    Object.keys(ownerMap).forEach(k => { if (ownerMap[k] === 0) delete ownerMap[k]; });

    const sorted = Object.entries(ownerMap).sort((a,b) => b[1]-a[1]);
    if (!sorted.length) { el.innerHTML = `<div class="activity-empty">No data yet.</div>`; return; }

    const rankClass = ["gold","silver","bronze"];
    el.innerHTML = sorted.map(([addr, count], i) => `
      <div class="lb-item">
        <div class="lb-rank ${rankClass[i]||"other"}">${i+1}</div>
        <span class="lb-addr">${addr.slice(0,8)}…${addr.slice(-4)}</span>
        <span class="lb-count">${count} NFT${count>1?"s":""}</span>
      </div>`).join("");
  } catch(e) {
    el.innerHTML = `<div class="activity-empty">Error: ${e.message}</div>`;
  }
}
setTimeout(() => { if (document.getElementById("leaderboard")) loadLeaderboard(); }, 2000);

