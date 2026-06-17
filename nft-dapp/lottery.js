/* ─── Lottery ABI ────────────────────────────────────────────────────────── */
const LOTTERY_ABI = [
  "function admin() view returns (address)",
  "function getRoundCount() view returns (uint256)",
  "function getRound(uint256 id) view returns (uint256 prize, address winner, bool drawn, uint256 startTime, uint256 playerCount)",
  "function getPlayers(uint256 roundId) view returns (address[])",
  "function currentRoundId() view returns (uint256)",
  "function isEntered(address who) view returns (bool)",
  "function hasEntered(uint256 roundId, address who) view returns (bool)",
  "function enter()",
  "function startRound() payable",
  "function drawWinner(uint256 roundId)",
  "event RoundStarted(uint256 indexed roundId, uint256 prize)",
  "event PlayerEntered(uint256 indexed roundId, address indexed player)",
  "event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint256 prize)",
];

/* ─── State ──────────────────────────────────────────────────────────────── */
let lotteryContract  = null;
let lotterySigner    = null;
let lotteryUserAddr  = null;
let isLotteryAdmin   = false;
let _currentRoundId  = -1;

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  if (!CONFIG.LOTTERY_CONTRACT || CONFIG.LOTTERY_CONTRACT === "PASTE_LOTTERY_ADDRESS") {
    document.getElementById("lotteryLoading").style.display = "none";
    document.getElementById("noRoundState")?.classList.remove("hidden");
    document.getElementById("noRoundMsg").textContent =
      "Lottery contract not yet deployed. Deploy Lottery.sol and paste the address in config.js.";
    return;
  }
  if (window.ethereum?.selectedAddress) {
    await initLotteryPage();
  } else {
    await loadCurrentRoundReadOnly();
  }
});

async function initLotteryPage() {
  if (!window.ethereum) return;
  try {
    const accounts  = await window.ethereum.request({ method: "eth_requestAccounts" });
    lotteryUserAddr = accounts[0];
    const provider  = new ethers.providers.Web3Provider(window.ethereum);
    lotterySigner   = provider.getSigner();
    lotteryContract = new ethers.Contract(CONFIG.LOTTERY_CONTRACT, LOTTERY_ABI, lotterySigner);

    await ensureSepolia();

    document.getElementById("lotteryNotConnected")?.classList.add("hidden");
    document.getElementById("lotteryConnected")?.classList.remove("hidden");
    const walletEl = document.getElementById("lotteryWalletShort");
    if (walletEl) walletEl.textContent = `${lotteryUserAddr.slice(0,6)}…${lotteryUserAddr.slice(-4)}`;

    const adminAddr = await lotteryContract.admin();
    isLotteryAdmin = adminAddr.toLowerCase() === lotteryUserAddr.toLowerCase();
    if (isLotteryAdmin) {
      document.getElementById("lotteryAdminBadge")?.classList.remove("hidden");
      const panel = document.getElementById("lotteryAdminPanel");
      if (panel) panel.style.display = "";
    }

    await loadCurrentRound();
    await loadPastRounds();

    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());
  } catch(e) {
    const isCallEx = e.code === "CALL_EXCEPTION" || e.message?.includes("CALL_EXCEPTION");
    showToast(isCallEx
      ? "Contract not found on Sepolia — was Remix VM used instead of Injected Provider?"
      : "Connect failed: " + (e.message || e), "error");
  }
}

async function connectWallet() { await initLotteryPage(); }

/* ─── Load current round ─────────────────────────────────────────────────── */
async function loadCurrentRoundReadOnly() {
  try {
    const con = await getLotteryReadContract();
    const count = (await con.getRoundCount()).toNumber();
    document.getElementById("lotteryLoading").style.display = "none";
    if (count === 0) { showNoRound(); return; }
    const id = count - 1;
    _currentRoundId = id;
    await renderCurrentRound(con, id);
    await loadPastRoundsFromContract(con, count);
  } catch(e) {
    document.getElementById("lotteryLoading").style.display = "none";
    const isCallEx = e.code === "CALL_EXCEPTION" || e.message?.includes("CALL_EXCEPTION");
    showNoRound(isCallEx
      ? "Contract not found on Sepolia. Redeploy Lottery.sol using Injected Provider in Remix (not Remix VM)."
      : "Error: " + e.message);
  }
}

async function loadCurrentRound() {
  document.getElementById("lotteryLoading").style.display = "";
  document.getElementById("currentRoundCard")?.classList.add("hidden");
  document.getElementById("noRoundState")?.classList.add("hidden");

  try {
    const con   = lotteryContract || await getLotteryReadContract();
    const count = (await con.getRoundCount()).toNumber();
    document.getElementById("lotteryLoading").style.display = "none";

    if (count === 0) { showNoRound(); populateDrawSelect(0); return; }

    const id = count - 1;
    _currentRoundId = id;
    populateDrawSelect(count);
    await renderCurrentRound(con, id);
    await loadPastRoundsFromContract(con, count);
  } catch(e) {
    document.getElementById("lotteryLoading").style.display = "none";
    showNoRound("Error: " + e.message);
  }
}

async function renderCurrentRound(con, id) {
  const r = await con.getRound(id);
  const prizeEth  = ethers.utils.formatEther(r.prize);
  const drawn     = r.drawn;
  const players   = await con.getPlayers(id);

  // Update UI
  document.getElementById("roundLabel").textContent  = `Round #${id}`;
  document.getElementById("roundPrize").textContent  = `${parseFloat(prizeEth).toFixed(4)} ETH`;
  document.getElementById("roundPlayerCount").textContent = r.playerCount.toNumber();
  document.getElementById("roundStarted").textContent = timeAgo(r.startTime.toNumber());

  const statusEl = document.getElementById("roundStatus");
  if (drawn) {
    if (statusEl) { statusEl.textContent = "Drawn"; statusEl.className = "lottery-round-status status-closed"; }
  } else {
    if (statusEl) { statusEl.textContent = "Open"; statusEl.className = "lottery-round-status status-open"; }
  }

  const count = r.playerCount.toNumber();
  let oddsText = "—";
  if (lotteryUserAddr && !drawn) {
    const entered = await con.hasEntered(id, lotteryUserAddr);
    oddsText = entered && count > 0 ? `1 in ${count}` : "—";
  }
  document.getElementById("roundOdds").textContent = oddsText;

  // Enter / drawn sections
  const enterSection  = document.getElementById("enterSection");
  const drawnSection  = document.getElementById("drawnSection");
  if (drawn) {
    enterSection?.classList.add("hidden");
    drawnSection?.classList.remove("hidden");
    const winnerEl = document.getElementById("roundWinner");
    if (winnerEl) winnerEl.textContent = r.winner !== ethers.constants.AddressZero
      ? `${r.winner.slice(0,6)}…${r.winner.slice(-4)}`
      : "No winner (no players)";
    // Check if current user won
    if (lotteryUserAddr && r.winner.toLowerCase() === lotteryUserAddr.toLowerCase()) {
      showToast("🎉 You won this round!", "success");
    }
  } else {
    enterSection?.classList.remove("hidden");
    drawnSection?.classList.add("hidden");

    // Check if already entered
    if (lotteryUserAddr) {
      const alreadyIn = await con.hasEntered(id, lotteryUserAddr);
      const enterBtn  = document.getElementById("enterBtn");
      const alreadyEl = document.getElementById("alreadyEnteredMsg");
      if (alreadyIn) {
        if (enterBtn) { enterBtn.disabled = true; enterBtn.textContent = "✓ Already Entered"; }
        alreadyEl?.classList.remove("hidden");
      }
    }
  }

  // Players list
  if (players.length > 0) {
    document.getElementById("playersSection")?.classList.remove("hidden");
    document.getElementById("playersCount").textContent = players.length;
    const playersList = document.getElementById("playersList");
    if (playersList) {
      playersList.innerHTML = players.map((addr, i) => {
        const isMe = lotteryUserAddr && addr.toLowerCase() === lotteryUserAddr.toLowerCase();
        return `
          <div class="player-row">
            <span class="player-num">${i + 1}</span>
            <span class="player-avatar" style="background:${addrToHue(addr)}">${addr.slice(2,4).toUpperCase()}</span>
            <a href="https://sepolia.etherscan.io/address/${addr}" target="_blank"
              class="player-addr mono">${addr.slice(0,8)}…${addr.slice(-6)}</a>
            ${isMe ? `<span class="board-you-tag">You</span>` : ""}
          </div>`;
      }).join("");
    }
  }

  document.getElementById("currentRoundCard")?.classList.remove("hidden");
  requestAnimationFrame(() => document.getElementById("currentRoundCard")?.classList.add("visible"));
}

/* ─── Enter lottery ──────────────────────────────────────────────────────── */
async function enterLottery() {
  if (!lotteryContract) { showToast("Connect wallet first.", "error"); return; }
  const enterBtn = document.getElementById("enterBtn");
  if (enterBtn) { enterBtn.disabled = true; enterBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Entering…`; }

  try {
    const tx = await lotteryContract.enter();
    showToast("Transaction sent! Confirming…");
    await tx.wait();
    showToast("🎰 You're in the lottery! Good luck.");
    launchConfetti();
    await loadCurrentRound();
    await loadPastRounds();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
    if (enterBtn) { enterBtn.disabled = false; enterBtn.innerHTML = "🎰 Enter Lottery (Free)"; }
  }
}

/* ─── Admin: Start round ─────────────────────────────────────────────────── */
async function startRound() {
  if (!lotteryContract || !isLotteryAdmin) return;
  const prizeFund = parseFloat(document.getElementById("prizeFund")?.value || "0");
  const prizeWei  = ethers.utils.parseEther(isNaN(prizeFund) || prizeFund < 0 ? "0" : String(prizeFund));

  const btn = document.getElementById("startRoundBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Starting…`; }

  try {
    const tx = await lotteryContract.startRound({ value: prizeWei });
    showToast("Starting round…");
    await tx.wait();
    showToast(`New round started! Prize: ${ethers.utils.formatEther(prizeWei)} ETH`);
    document.getElementById("prizeFund").value = "";
    await loadCurrentRound();
    await loadPastRounds();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Start Round"; }
  }
}

/* ─── Admin: Draw winner ─────────────────────────────────────────────────── */
async function drawWinner() {
  if (!lotteryContract || !isLotteryAdmin) return;
  const sel = document.getElementById("drawRoundSelect");
  const id  = parseInt(sel?.value);
  if (isNaN(id) || sel.value === "") { showToast("Select a round.", "error"); return; }
  if (!confirm(`Draw winner for Round #${id}? This cannot be undone.`)) return;

  const btn = document.getElementById("drawBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Drawing…`; }

  try {
    const tx = await lotteryContract.drawWinner(id);
    showToast("Drawing winner…");
    const receipt = await tx.wait();
    const event   = receipt.events?.find(e => e.event === "WinnerDrawn");
    const winner  = event?.args?.winner || "unknown";
    const prize   = event?.args?.prize  ? ethers.utils.formatEther(event.args.prize) : "0";

    showWinReceipt(id, winner, prize, tx.hash, receipt.blockNumber);
    launchConfetti();
    playMintSound();
    await loadCurrentRound();
    await loadPastRounds();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Draw Winner"; }
  }
}

/* ─── Past rounds ────────────────────────────────────────────────────────── */
async function loadPastRounds() {
  const con = lotteryContract || await getLotteryReadContract();
  const count = (await con.getRoundCount()).toNumber();
  await loadPastRoundsFromContract(con, count);
}

async function loadPastRoundsFromContract(con, count) {
  const list = document.getElementById("pastRoundsList");
  if (!list) return;
  const drawn = [];
  for (let i = count - 1; i >= 0; i--) {
    const r = await con.getRound(i);
    if (r.drawn) drawn.push({ id: i, ...r });
  }
  if (drawn.length === 0) {
    list.innerHTML = `<div class="activity-empty">No completed rounds yet.</div>`;
    return;
  }
  list.innerHTML = drawn.map(r => {
    const prizeEth = parseFloat(ethers.utils.formatEther(r.prize)).toFixed(4);
    const winner   = r.winner !== ethers.constants.AddressZero
      ? `${r.winner.slice(0,6)}…${r.winner.slice(-4)}`
      : "No winner";
    const isMe     = lotteryUserAddr && r.winner.toLowerCase() === lotteryUserAddr.toLowerCase();
    return `
      <div class="past-round-row">
        <div class="past-round-id">Round #${r.id}</div>
        <div class="past-round-info">
          <span class="past-round-winner mono">${winner}</span>
          ${isMe ? `<span class="board-you-tag">You!</span>` : ""}
        </div>
        <div class="past-round-prize">${prizeEth} ETH</div>
        <div class="past-round-count">${r.playerCount.toNumber()} players</div>
      </div>`;
  }).join("");
}

/* ─── Win receipt ────────────────────────────────────────────────────────── */
function showWinReceipt(roundId, winner, prizeEth, txHash, blockNum) {
  const modal = document.getElementById("winReceiptModal");
  if (!modal) return;
  document.getElementById("winReceiptBody").innerHTML = [
    { label:"Round",    value:`#${roundId}` },
    { label:"Winner",   value:`${winner.slice(0,10)}…${winner.slice(-6)}` },
    { label:"Prize",    value:`${parseFloat(prizeEth).toFixed(4)} ETH` },
    { label:"Tx Hash",  value:`${txHash.slice(0,10)}…${txHash.slice(-6)}` },
    { label:"Block",    value:`#${blockNum}` },
    { label:"Network",  value:"Sepolia Testnet" },
  ].map(r => `
    <div class="receipt-row">
      <span class="receipt-row-label">${r.label}</span>
      <span class="receipt-row-value">${r.value}</span>
    </div>`).join("");
  document.getElementById("winEtherscan").href = `https://sepolia.etherscan.io/tx/${txHash}`;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeWinReceipt(e) {
  if (e && e.target !== document.getElementById("winReceiptModal")) return;
  document.getElementById("winReceiptModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
async function getLotteryReadContract() {
  const p = await getReadProvider();
  return new ethers.Contract(CONFIG.LOTTERY_CONTRACT, LOTTERY_ABI, p);
}

function showNoRound(msg) {
  document.getElementById("lotteryLoading").style.display = "none";
  document.getElementById("noRoundState")?.classList.remove("hidden");
  const msgEl = document.getElementById("noRoundMsg");
  if (msg && msgEl) msgEl.textContent = msg;
}

function populateDrawSelect(count) {
  const sel = document.getElementById("drawRoundSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">Select round…</option>`;
  for (let i = count - 1; i >= 0; i--) {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = `Round #${i}`;
    sel.appendChild(opt);
  }
}

function addrToHue(addr) {
  const hue = parseInt(addr.slice(2,6), 16) % 360;
  return `hsl(${hue},60%,35%)`;
}

function timeAgo(ts) {
  const diff = Math.floor(Date.now()/1000) - ts;
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return `${Math.floor(diff/86400)}d ago`;
}
