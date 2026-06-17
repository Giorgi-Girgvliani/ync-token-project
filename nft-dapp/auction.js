/* ─── Auction ABI ────────────────────────────────────────────────────────── */
const AUCTION_ABI = [
  "function admin() view returns (address)",
  "function getAuctionCount() view returns (uint256)",
  "function getAuction(uint256 id) view returns (uint256 tokenId, address seller, address highestBidder, uint256 highestBid, uint256 endTime, bool active, bool settled)",
  "function pendingReturns(uint256 auctionId, address bidder) view returns (uint256)",
  "function createAuction(uint256 tokenId, uint256 durationSeconds)",
  "function bid(uint256 auctionId) payable",
  "function endAuction(uint256 auctionId)",
  "function cancelAuction(uint256 auctionId)",
  "function withdraw(uint256 auctionId)",
  "event AuctionCreated(uint256 indexed auctionId, uint256 tokenId, uint256 endTime)",
  "event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount)",
  "event AuctionEnded(uint256 indexed auctionId, address winner, uint256 amount, uint256 tokenId)",
];

const NFT_APPROVE_ABI = [
  "function approve(address to, uint256 tokenId)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function ownerOf(uint256 tokenId) view returns (address)",
];

/* ─── State ──────────────────────────────────────────────────────────────── */
let auctionContract = null;
let auctionSigner   = null;
let auctionUserAddr = null;
let isAuctionAdmin  = false;
let _activeBidId    = null;
let _allAuctions    = [];

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  if (!CONFIG.AUCTION_CONTRACT || CONFIG.AUCTION_CONTRACT === "PASTE_AUCTION_ADDRESS") {
    document.getElementById("auctionLoading").style.display = "none";
    document.getElementById("auctionEmpty")?.classList.remove("hidden");
    document.getElementById("auctionEmptyMsg").textContent =
      "Auction contract not yet deployed. Deploy Auction.sol (with NFT contract address as constructor arg) and paste the address in config.js.";
    return;
  }
  if (window.ethereum?.selectedAddress) {
    await initAuctionPage();
  } else {
    await loadAuctionsReadOnly();
  }
});

async function initAuctionPage() {
  if (!window.ethereum) return;
  try {
    const accounts  = await window.ethereum.request({ method: "eth_requestAccounts" });
    auctionUserAddr = accounts[0];
    const provider  = new ethers.providers.Web3Provider(window.ethereum);
    auctionSigner   = provider.getSigner();
    auctionContract = new ethers.Contract(CONFIG.AUCTION_CONTRACT, AUCTION_ABI, auctionSigner);

    await ensureSepolia();

    document.getElementById("auctionNotConnected")?.classList.add("hidden");
    document.getElementById("auctionConnected")?.classList.remove("hidden");
    const walletEl = document.getElementById("auctionWalletShort");
    if (walletEl) walletEl.textContent = `${auctionUserAddr.slice(0,6)}…${auctionUserAddr.slice(-4)}`;

    const adminAddr = await auctionContract.admin();
    isAuctionAdmin = adminAddr.toLowerCase() === auctionUserAddr.toLowerCase();
    if (isAuctionAdmin) {
      document.getElementById("auctionAdminBadge")?.classList.remove("hidden");
      const panel = document.getElementById("auctionAdminPanel");
      if (panel) panel.style.display = "";
    }

    await loadAuctions();
    await checkPendingRefunds();
    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());
  } catch(e) {
    showToast("Connect failed: " + (e.message || e), "error");
  }
}

async function connectWallet() { await initAuctionPage(); }

/* ─── Load auctions ──────────────────────────────────────────────────────── */
async function loadAuctionsReadOnly() {
  try {
    const con = await getAuctionReadContract();
    await fetchAndRenderAuctions(con);
  } catch(e) {
    document.getElementById("auctionLoading").style.display = "none";
    document.getElementById("auctionEmpty")?.classList.remove("hidden");
  }
}

async function loadAuctions() {
  document.getElementById("auctionLoading").style.display = "";
  document.getElementById("activeAuctionGrid").innerHTML = "";
  document.getElementById("auctionEmpty")?.classList.add("hidden");
  try {
    const con = auctionContract || await getAuctionReadContract();
    await fetchAndRenderAuctions(con);
    populateAdminEndSelect();
  } catch(e) {
    document.getElementById("auctionLoading").style.display = "none";
    document.getElementById("auctionEmpty")?.classList.remove("hidden");
    document.getElementById("auctionEmptyMsg").textContent = "Error: " + e.message;
  }
}

async function fetchAndRenderAuctions(con) {
  const count = (await con.getAuctionCount()).toNumber();
  document.getElementById("auctionLoading").style.display = "none";

  _allAuctions = [];
  for (let i = 0; i < count; i++) {
    const a = await con.getAuction(i);
    _allAuctions.push({ id: i, ...a });
  }

  const active   = _allAuctions.filter(a => a.active);
  const settled  = _allAuctions.filter(a => !a.active);

  if (active.length === 0) {
    document.getElementById("auctionEmpty")?.classList.remove("hidden");
  } else {
    const grid = document.getElementById("activeAuctionGrid");
    active.forEach(a => grid.appendChild(buildAuctionCard(a)));
    requestAnimationFrame(() => grid.querySelectorAll(".auction-card:not(.visible)").forEach(c => c.classList.add("visible")));
  }

  renderSettledAuctions(settled);
}

function buildAuctionCard(a) {
  const card = document.createElement("div");
  card.className = "auction-card reveal";
  card.dataset.auctionId = a.id;

  const tokenId  = a.tokenId.toNumber();
  const highBid  = parseFloat(ethers.utils.formatEther(a.highestBid)).toFixed(4);
  const endTime  = a.endTime.toNumber();
  const isEnded  = Math.floor(Date.now()/1000) > endTime;
  const noBids   = a.highestBidder === ethers.constants.AddressZero;
  const isWinner = auctionUserAddr && !noBids && a.highestBidder.toLowerCase() === auctionUserAddr.toLowerCase();
  const imgSrc   = `${CONFIG.BASE_URL}/images/${tokenId}.svg`;

  card.innerHTML = `
    <div class="auction-card-img-wrap">
      <img src="${imgSrc}" alt="NFT #${tokenId}" class="auction-card-img" loading="lazy"
        onerror="this.src='images/${tokenId}.svg'"/>
      <div class="auction-card-badge">NFT #${tokenId}</div>
    </div>
    <div class="auction-card-body">
      <div class="auction-card-id-row">
        <span class="auction-id-label">Auction #${a.id}</span>
        ${isEnded ? `<span class="election-status status-closed">Ended</span>` : `<span class="election-status status-open">Live</span>`}
      </div>
      <div class="auction-bid-row">
        <div>
          <div class="auction-bid-label">${noBids ? "Starting Bid" : "Highest Bid"}</div>
          <div class="auction-bid-amount">${noBids ? "0" : highBid} ETH</div>
          ${!noBids ? `<div class="auction-bidder mono">${a.highestBidder.slice(0,8)}…${a.highestBidder.slice(-4)}${isWinner ? " <span class='board-you-tag'>You</span>" : ""}</div>` : ""}
        </div>
        <div class="auction-countdown" id="countdown-${a.id}"></div>
      </div>
      ${isEnded
        ? `<button class="btn btn-ghost" style="width:100%;margin-top:12px" onclick="finalizeAuction(${a.id})">
            Finalize Auction →
           </button>`
        : `<button class="btn btn-primary glow-btn" style="width:100%;margin-top:12px" onclick="openBidModal(${a.id})">
            Place Bid ↑
           </button>`
      }
    </div>
  `;

  // Live countdown
  if (!isEnded) {
    startCountdown(`countdown-${a.id}`, endTime);
  }

  return card;
}

function renderSettledAuctions(settled) {
  const list = document.getElementById("settledAuctionList");
  if (!list) return;
  if (settled.length === 0) {
    list.innerHTML = `<div class="activity-empty">No settled auctions yet.</div>`;
    return;
  }
  list.innerHTML = settled.map(a => {
    const tokenId = a.tokenId.toNumber();
    const noBids  = a.highestBidder === ethers.constants.AddressZero;
    const highBid = parseFloat(ethers.utils.formatEther(a.highestBid)).toFixed(4);
    return `
      <div class="settled-row">
        <img src="${CONFIG.BASE_URL}/images/${tokenId}.svg" alt="NFT #${tokenId}" class="settled-thumb"
          onerror="this.src='images/${tokenId}.svg'"/>
        <div class="settled-info">
          <span class="settled-label">Auction #${a.id} — NFT #${tokenId}</span>
          ${noBids
            ? `<span class="settled-no-bids">No bids — returned to seller</span>`
            : `<span class="settled-winner mono">${a.highestBidder.slice(0,8)}…${a.highestBidder.slice(-4)}</span>`
          }
        </div>
        <div class="settled-amount">${noBids ? "—" : highBid + " ETH"}</div>
      </div>`;
  }).join("");
}

/* ─── Bid Modal ──────────────────────────────────────────────────────────── */
async function openBidModal(auctionId) {
  _activeBidId = auctionId;
  const a = _allAuctions.find(x => x.id === auctionId);
  if (!a) return;

  const tokenId  = a.tokenId.toNumber();
  const highBid  = ethers.utils.formatEther(a.highestBid);
  const minNext  = parseFloat(highBid) === 0
    ? "0.001"
    : (parseFloat(highBid) + 0.001).toFixed(4);
  const noBids   = a.highestBidder === ethers.constants.AddressZero;
  const bidderStr = noBids ? "None yet" : `${a.highestBidder.slice(0,8)}…${a.highestBidder.slice(-4)}`;

  document.getElementById("bidModalTitle").textContent = `NFT #${tokenId} — Auction #${auctionId}`;
  document.getElementById("bidCurrentBid").textContent = noBids ? "0 ETH" : `${parseFloat(highBid).toFixed(4)} ETH`;
  document.getElementById("bidCurrentBidder").textContent = bidderStr;
  document.getElementById("bidMinNext").textContent = `${minNext} ETH`;
  document.getElementById("bidAmount").value = minNext;
  document.getElementById("bidErrorMsg")?.classList.add("hidden");

  // Live countdown in modal
  startCountdown("bidTimeLeft", a.endTime.toNumber());

  const modal = document.getElementById("bidModal");
  modal?.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeBidModal(e) {
  if (e && e.target !== document.getElementById("bidModal")) return;
  document.getElementById("bidModal")?.classList.add("hidden");
  document.body.style.overflow = "";
  _activeBidId = null;
}

async function placeBid() {
  if (_activeBidId === null) return;
  if (!auctionContract) { showToast("Connect wallet first.", "error"); return; }

  const amtStr = document.getElementById("bidAmount")?.value;
  const errEl  = document.getElementById("bidErrorMsg");
  if (!amtStr || parseFloat(amtStr) <= 0) {
    if (errEl) { errEl.textContent = "Enter a bid amount."; errEl.classList.remove("hidden"); }
    return;
  }

  const a = _allAuctions.find(x => x.id === _activeBidId);
  const currentBid = parseFloat(ethers.utils.formatEther(a?.highestBid || 0));
  if (parseFloat(amtStr) <= currentBid) {
    if (errEl) { errEl.textContent = `Must exceed current bid of ${currentBid.toFixed(4)} ETH.`; errEl.classList.remove("hidden"); }
    return;
  }

  const btn = document.getElementById("placeBidBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Bidding…`; }

  try {
    const weiAmt = ethers.utils.parseEther(amtStr);
    const tx = await auctionContract.bid(_activeBidId, { value: weiAmt });
    showToast("Bid sent! Confirming…");
    const receipt = await tx.wait();

    closeBidModal();
    showBidReceipt(_activeBidId, amtStr, tx.hash, receipt.blockNumber);
    playMintSound();
    await loadAuctions();
    await checkPendingRefunds();
  } catch(e) {
    const msg = e.code === 4001 ? "Cancelled." : (e.reason || e.message);
    if (errEl) { errEl.textContent = msg; errEl.classList.remove("hidden"); }
    showToast(msg, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Place Bid →"; }
  }
}

/* ─── Finalize (public) ──────────────────────────────────────────────────── */
async function finalizeAuction(auctionId) {
  if (!auctionContract) { showToast("Connect wallet first.", "error"); return; }
  try {
    const tx = await auctionContract.endAuction(auctionId);
    showToast("Finalizing auction…");
    await tx.wait();
    showToast("Auction settled! NFT transferred.");
    launchConfetti();
    await loadAuctions();
    await checkPendingRefunds();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  }
}

/* ─── Admin: Create auction ──────────────────────────────────────────────── */
let _auctionTokenId = null;
let _auctionDuration = 86400;

function setAuctionToken(id, btn) {
  _auctionTokenId = id;
  document.querySelectorAll("#auctionAdminPanel .filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById("auctionTokenId").value = id;
}

function setAuctionDuration(secs, btn) {
  _auctionDuration = secs;
  document.getElementById("auctionDuration").value = secs;
  const parent = btn.closest(".admin-form");
  parent?.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

async function createAuction() {
  if (!auctionContract || !isAuctionAdmin) return;
  if (!_auctionTokenId) { showToast("Select a token ID.", "error"); return; }

  const btn = document.getElementById("createAuctionBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Creating…`; }

  try {
    // First: check approval
    const nftCon = new ethers.Contract(CONFIG.NFT_CONTRACT, NFT_APPROVE_ABI, auctionSigner);
    const approved = await nftCon.getApproved(_auctionTokenId);
    if (approved.toLowerCase() !== CONFIG.AUCTION_CONTRACT.toLowerCase()) {
      showToast("Approving auction contract for this token…");
      const approveTx = await nftCon.approve(CONFIG.AUCTION_CONTRACT, _auctionTokenId);
      await approveTx.wait();
      showToast("Approved! Creating auction…");
    }

    const tx = await auctionContract.createAuction(_auctionTokenId, _auctionDuration);
    await tx.wait();
    showToast(`Auction for NFT #${_auctionTokenId} created! 🔨`);
    await loadAuctions();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Create Auction`; }
  }
}

async function endAuctionAdmin() {
  if (!auctionContract || !isAuctionAdmin) return;
  const sel = document.getElementById("endAuctionSelect");
  const id  = parseInt(sel?.value);
  if (isNaN(id) || sel.value === "") { showToast("Select an auction.", "error"); return; }
  try {
    const tx = await auctionContract.endAuction(id);
    showToast("Ending auction…");
    await tx.wait();
    showToast("Auction ended and settled.");
    await loadAuctions();
    await checkPendingRefunds();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  }
}

function populateAdminEndSelect() {
  const sel = document.getElementById("endAuctionSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">Select auction…</option>`;
  _allAuctions.filter(a => a.active).forEach(a => {
    const opt = document.createElement("option");
    opt.value = a.id;
    opt.textContent = `Auction #${a.id} — NFT #${a.tokenId.toNumber()}`;
    sel.appendChild(opt);
  });
}

/* ─── Refund check ───────────────────────────────────────────────────────── */
async function checkPendingRefunds() {
  if (!auctionUserAddr || !auctionContract) return;
  let totalRefund = ethers.BigNumber.from(0);
  const refundable = [];

  for (const a of _allAuctions) {
    const pending = await auctionContract.pendingReturns(a.id, auctionUserAddr);
    if (pending.gt(0)) {
      totalRefund = totalRefund.add(pending);
      refundable.push({ auctionId: a.id, amount: pending });
    }
  }

  const banner = document.getElementById("pendingRefundBanner");
  if (banner) banner.classList.toggle("hidden", totalRefund.isZero());

  // Store for withdraw modal
  window._refundable = refundable;
}

/* ─── Withdraw modal ─────────────────────────────────────────────────────── */
function showWithdrawModal() {
  const modal = document.getElementById("withdrawModal");
  const list  = document.getElementById("withdrawList");
  if (!modal || !list) return;

  const refunds = window._refundable || [];
  if (refunds.length === 0) {
    list.innerHTML = `<p style="color:var(--text-muted);text-align:center">Nothing to claim.</p>`;
  } else {
    list.innerHTML = refunds.map(r => `
      <div class="withdraw-row">
        <span>Auction #${r.auctionId}: <strong>${parseFloat(ethers.utils.formatEther(r.amount)).toFixed(6)} ETH</strong></span>
        <button class="btn btn-primary btn-sm" onclick="doWithdraw(${r.auctionId})">Claim</button>
      </div>`).join("");
  }

  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

async function doWithdraw(auctionId) {
  if (!auctionContract) return;
  try {
    const tx = await auctionContract.withdraw(auctionId);
    showToast("Claiming refund…");
    await tx.wait();
    showToast("ETH refund claimed! ✓");
    closeWithdrawModal();
    await checkPendingRefunds();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  }
}

function closeWithdrawModal(e) {
  if (e && e.target !== document.getElementById("withdrawModal")) return;
  document.getElementById("withdrawModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─── Bid Receipt ────────────────────────────────────────────────────────── */
function showBidReceipt(auctionId, amtEth, txHash, blockNum) {
  const modal = document.getElementById("bidReceiptModal");
  if (!modal) return;
  document.getElementById("bidReceiptBody").innerHTML = [
    { label:"Auction",  value:`#${auctionId}` },
    { label:"Bid",      value:`${parseFloat(amtEth).toFixed(6)} ETH` },
    { label:"Bidder",   value:`${auctionUserAddr?.slice(0,6)}…${auctionUserAddr?.slice(-4)}` },
    { label:"Tx Hash",  value:`${txHash.slice(0,10)}…${txHash.slice(-6)}` },
    { label:"Block",    value:`#${blockNum}` },
    { label:"Network",  value:"Sepolia Testnet" },
  ].map(r => `
    <div class="receipt-row">
      <span class="receipt-row-label">${r.label}</span>
      <span class="receipt-row-value">${r.value}</span>
    </div>`).join("");
  document.getElementById("bidEtherscan").href = `https://sepolia.etherscan.io/tx/${txHash}`;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeBidReceipt(e) {
  if (e && e.target !== document.getElementById("bidReceiptModal")) return;
  document.getElementById("bidReceiptModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
async function getAuctionReadContract() {
  const p = await getReadProvider();
  return new ethers.Contract(CONFIG.AUCTION_CONTRACT, AUCTION_ABI, p);
}

function startCountdown(elementId, endTime) {
  const el = document.getElementById(elementId);
  function tick() {
    if (!el) return;
    const left = endTime - Math.floor(Date.now()/1000);
    if (left <= 0) { el.textContent = "Ended"; return; }
    const d = Math.floor(left / 86400);
    const h = Math.floor((left % 86400) / 3600);
    const m = Math.floor((left % 3600) / 60);
    const s = left % 60;
    el.textContent = d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
    setTimeout(tick, 1000);
  }
  tick();
}
