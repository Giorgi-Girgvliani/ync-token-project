/* ─── Voting Contract ABI ────────────────────────────────────────────────── */
const VOTING_ABI = [
  "function admin() view returns (address)",
  "function getElectionCount() view returns (uint256)",
  "function elections(uint256) view returns (string title, string description, uint256 startTime, uint256 endTime, bool active, uint256 totalVotes)",
  "function getCandidates(uint256 electionId) view returns (string[] names, uint256[] votes)",
  "function getVoterChoice(uint256 electionId, address voter) view returns (bool voted, uint256 choiceIndex, string choiceName)",
  "function getWinner(uint256 electionId) view returns (string winnerName, uint256 winnerVotes, bool isTie)",
  "function isVotingOpen(uint256 electionId) view returns (bool)",
  "function vote(uint256 electionId, uint256 candidateIndex)",
  "function createElection(string title, string description, string[] candidateNames, uint256 durationSeconds)",
  "function closeElection(uint256 electionId)",
  "event VoteCast(uint256 indexed electionId, address indexed voter, uint256 candidateIndex, string candidateName)",
  "event ElectionCreated(uint256 indexed electionId, string title, address indexed creator, uint256 endTime)",
];

/* ─── State ──────────────────────────────────────────────────────────────── */
let votingContract   = null;
let votingProvider   = null;
let votingSigner     = null;
let votingUserAddr   = null;
let isVotingAdmin    = false;
let currentElectionId = null;
let selectedCandidate = null;
let _lastVoteTxHash   = null;
let _lastVoteElTitle  = null;
let _lastVoteCandidate = null;

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  if (CONFIG.VOTING_CONTRACT === "PASTE_YOUR_VOTING_CONTRACT_ADDRESS") {
    document.getElementById("electionsEmpty")?.classList.remove("hidden");
    document.getElementById("electionsEmptyMsg").textContent =
      "Voting contract not yet deployed. See voting.sol — deploy in Remix and paste the address in config.js.";
    return;
  }

  // Auto-connect if MetaMask already has a session
  if (window.ethereum?.selectedAddress) {
    await initVotingPage();
  } else {
    await loadElectionsReadOnly();
  }
});

/* ─── Connect (called from shared script.js connectWallet, or standalone) ── */
async function initVotingPage() {
  if (!window.ethereum) return;
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    votingUserAddr  = accounts[0];
    votingProvider  = new ethers.providers.Web3Provider(window.ethereum);
    votingSigner    = votingProvider.getSigner();
    votingContract  = new ethers.Contract(CONFIG.VOTING_CONTRACT, VOTING_ABI, votingSigner);

    // Ensure Sepolia
    await ensureSepolia();

    // Update UI
    document.getElementById("voteNotConnected")?.classList.add("hidden");
    document.getElementById("voteConnected")?.classList.remove("hidden");
    const walletEl = document.getElementById("voteWalletShort");
    if (walletEl) walletEl.textContent = `${votingUserAddr.slice(0,6)}…${votingUserAddr.slice(-4)}`;

    // Check admin
    const adminAddr = await votingContract.admin();
    isVotingAdmin = adminAddr.toLowerCase() === votingUserAddr.toLowerCase();
    if (isVotingAdmin) {
      document.getElementById("adminBadge")?.classList.remove("hidden");
      const panel = document.getElementById("adminPanel");
      if (panel) panel.style.display = "";
    }

    await loadElections();

    // Listen for changes
    window.ethereum.on("accountsChanged", () => location.reload());
    window.ethereum.on("chainChanged",    () => location.reload());
  } catch (e) {
    showToast("Connect failed: " + (e.message || e), "error");
  }
}

// Override the shared connectWallet button on voting page
async function connectWallet() { await initVotingPage(); }

/* ─── Load elections (with wallet) ──────────────────────────────────────── */
async function loadElections() {
  const list    = document.getElementById("electionsList");
  const empty   = document.getElementById("electionsEmpty");
  const loading = document.getElementById("electionsLoading");
  if (!list) return;

  loading?.classList.remove("hidden");
  list.innerHTML = "";
  empty?.classList.add("hidden");

  try {
    const contract = votingContract || await getReadContract();
    const count    = (await contract.getElectionCount()).toNumber();

    loading?.classList.add("hidden");

    if (count === 0) {
      empty?.classList.remove("hidden");
      populateResultsSelects(0);
      return;
    }

    for (let id = count - 1; id >= 0; id--) {
      await renderElectionCard(contract, id, list);
    }
    populateResultsSelects(count);
    populateAdminCloseSelect(count);
  } catch (e) {
    loading?.classList.add("hidden");
    list.innerHTML = `<div class="activity-empty">Error loading elections: ${e.message}</div>`;
  }
}

/* ─── Read-only (no wallet) ──────────────────────────────────────────────── */
async function loadElectionsReadOnly() {
  if (CONFIG.VOTING_CONTRACT === "PASTE_YOUR_VOTING_CONTRACT_ADDRESS") return;
  const list    = document.getElementById("electionsList");
  const loading = document.getElementById("electionsLoading");
  const empty   = document.getElementById("electionsEmpty");
  if (!list) return;
  loading?.classList.remove("hidden");
  try {
    const contract = await getReadContract();
    const count    = (await contract.getElectionCount()).toNumber();
    loading?.classList.add("hidden");
    if (count === 0) { empty?.classList.remove("hidden"); return; }
    for (let id = count - 1; id >= 0; id--) {
      await renderElectionCard(contract, id, list);
    }
    populateResultsSelects(count);
  } catch { loading?.classList.add("hidden"); }
}

async function getReadContract() {
  const p = await getReadProvider();
  return new ethers.Contract(CONFIG.VOTING_CONTRACT, VOTING_ABI, p);
}

/* ─── Render one election card ───────────────────────────────────────────── */
async function renderElectionCard(contract, id, container) {
  const el = await contract.elections(id);
  const now = Math.floor(Date.now() / 1000);
  const isOpen   = el.active && now >= el.startTime.toNumber() && now <= el.endTime.toNumber();
  const isEnded  = !el.active || now > el.endTime.toNumber();
  const timeLeft = el.endTime.toNumber() - now;

  let statusLabel, statusClass;
  if (isOpen)        { statusLabel = "Voting Open";   statusClass = "status-open"; }
  else if (isEnded)  { statusLabel = "Closed";        statusClass = "status-closed"; }
  else               { statusLabel = "Not Started";   statusClass = "status-pending"; }

  const card = document.createElement("div");
  card.className = "election-card reveal";
  card.dataset.id = id;
  card.innerHTML = `
    <div class="election-card-top">
      <div class="election-card-info">
        <div class="election-meta">
          <span class="election-id">#${id}</span>
          <span class="election-status ${statusClass}">${statusLabel}</span>
        </div>
        <h3 class="election-title-text">${escHtml(el.title)}</h3>
        ${el.description ? `<p class="election-desc">${escHtml(el.description)}</p>` : ""}
      </div>
      <div class="election-card-stats">
        <div class="election-stat"><strong>${el.totalVotes.toNumber()}</strong><span>votes</span></div>
        ${isOpen ? `<div class="election-stat time-left"><strong id="tl-${id}"></strong><span>remaining</span></div>` : ""}
      </div>
    </div>
    ${isOpen ? `
    <div class="election-card-footer">
      <button class="btn btn-primary btn-sm glow-btn" onclick="openVoteModal(${id})">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Cast Vote
      </button>
      <button class="btn btn-ghost btn-sm" onclick="openVoteModal(${id}, true)">View Results</button>
    </div>` : `
    <div class="election-card-footer">
      <button class="btn btn-ghost btn-sm" onclick="openVoteModal(${id}, true)">View Results →</button>
    </div>`}
  `;
  container.appendChild(card);

  // Live countdown
  if (isOpen) {
    const tlEl = document.getElementById(`tl-${id}`);
    function tick() {
      const left = el.endTime.toNumber() - Math.floor(Date.now()/1000);
      if (left <= 0) { tlEl && (tlEl.textContent = "Ended"); return; }
      const h = Math.floor(left/3600), m = Math.floor((left%3600)/60), s = left%60;
      if (tlEl) tlEl.textContent = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
      setTimeout(tick, 1000);
    }
    tick();
  }
}

/* ─── Vote Modal ─────────────────────────────────────────────────────────── */
async function openVoteModal(electionId, resultsOnly = false) {
  currentElectionId = electionId;
  selectedCandidate = null;

  const modal = document.getElementById("voteModal");
  if (!modal) return;

  try {
    const contract   = votingContract || await getReadContract();
    const el         = await contract.elections(electionId);
    const { names, votes } = await contract.getCandidates(electionId);
    const totalVotes = el.totalVotes.toNumber();

    document.getElementById("voteModalTitle").textContent = el.title;
    document.getElementById("voteModalDesc").textContent  = el.description || "";

    // Check if user already voted
    let userVoted = false;
    let userChoice = -1;
    if (votingUserAddr) {
      const v = await contract.getVoterChoice(electionId, votingUserAddr);
      userVoted  = v.voted;
      userChoice = userVoted ? v.choiceIndex.toNumber() : -1;
    }

    const isOpen = el.active && Math.floor(Date.now()/1000) <= el.endTime.toNumber();
    const canVote = isOpen && !userVoted && !resultsOnly && votingUserAddr;

    // Render candidates
    const optionsEl = document.getElementById("candidateOptions");
    optionsEl.innerHTML = "";
    const maxVotes = Math.max(...votes.map(v => v.toNumber()), 1);

    names.forEach((name, i) => {
      const v = votes[i].toNumber();
      const pct = totalVotes ? Math.round(v / totalVotes * 100) : 0;
      const isWinner = v === maxVotes && totalVotes > 0;

      const opt = document.createElement("div");
      opt.className = "candidate-option" + (i === userChoice ? " user-choice" : "");
      opt.dataset.index = i;
      opt.innerHTML = `
        <div class="candidate-row">
          <div class="candidate-select-area">
            ${canVote ? `<div class="candidate-radio" id="radio-${i}"></div>` : ""}
            <span class="candidate-name">${escHtml(name)}</span>
            ${i === userChoice ? `<span class="your-vote-tag">Your vote</span>` : ""}
            ${isWinner && totalVotes > 0 ? `<span class="leading-tag">Leading</span>` : ""}
          </div>
          <span class="candidate-pct">${pct}%</span>
        </div>
        <div class="candidate-bar-bg">
          <div class="candidate-bar-fill" style="width:0%" data-pct="${pct}"
            ${isWinner && totalVotes > 0 ? 'style="width:0%;background:linear-gradient(90deg,#7c3aed,#10b981)"' : ""}
          ></div>
        </div>
        <div class="candidate-vote-count">${v} vote${v !== 1 ? "s" : ""}</div>
      `;

      if (canVote) {
        opt.addEventListener("click", () => selectCandidate(i, names.length));
      }
      optionsEl.appendChild(opt);
    });

    // Animate bars after render
    requestAnimationFrame(() => {
      optionsEl.querySelectorAll(".candidate-bar-fill").forEach(b => {
        b.style.width = b.dataset.pct + "%";
      });
    });

    // Already voted message
    const alreadyEl = document.getElementById("alreadyVotedMsg");
    if (userVoted) {
      alreadyEl.classList.remove("hidden");
      alreadyEl.innerHTML = `✓ You voted for <strong>${escHtml(names[userChoice])}</strong>. Results update live.`;
    } else {
      alreadyEl.classList.add("hidden");
    }

    // Cast button
    const castBtn = document.getElementById("castVoteBtn");
    const actionsEl = document.getElementById("voteActions");
    if (!canVote || userVoted || resultsOnly) {
      if (actionsEl) actionsEl.style.display = "none";
    } else {
      if (actionsEl) actionsEl.style.display = "";
      if (castBtn) castBtn.disabled = true;
    }

    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  } catch(e) {
    showToast("Error loading election: " + e.message, "error");
  }
}

function selectCandidate(index, total) {
  selectedCandidate = index;
  for (let i = 0; i < total; i++) {
    const opt   = document.querySelector(`.candidate-option[data-index="${i}"]`);
    const radio = document.getElementById(`radio-${i}`);
    opt?.classList.toggle("selected", i === index);
    if (radio) radio.classList.toggle("checked", i === index);
  }
  const castBtn = document.getElementById("castVoteBtn");
  if (castBtn) castBtn.disabled = false;
}

function closeVoteModal(e) {
  if (e && e.target !== document.getElementById("voteModal")) return;
  document.getElementById("voteModal")?.classList.add("hidden");
  document.body.style.overflow = "";
  selectedCandidate = null;
}

/* ─── Cast Vote ──────────────────────────────────────────────────────────── */
async function castVote() {
  if (selectedCandidate === null || currentElectionId === null) {
    showToast("Pick a candidate first.", "error"); return;
  }
  if (!votingContract) { showToast("Connect wallet first.", "error"); return; }

  const castBtn = document.getElementById("castVoteBtn");
  if (castBtn) { castBtn.disabled = true; castBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Sending…`; }

  try {
    const tx = await votingContract.vote(currentElectionId, selectedCandidate);
    showToast("Vote sent! Waiting for confirmation…");
    const receipt = await tx.wait();

    // Extract candidate name from event
    const event = receipt.events?.find(e => e.event === "VoteCast");
    const candidateName = event?.args?.candidateName || `Candidate #${selectedCandidate}`;
    const elTitle = (await votingContract.elections(currentElectionId)).title;

    _lastVoteTxHash    = tx.hash;
    _lastVoteElTitle   = elTitle;
    _lastVoteCandidate = candidateName;

    closeVoteModal();
    showVoteReceipt(elTitle, candidateName, tx.hash, receipt.blockNumber, receipt.gasUsed?.toString());
    playMintSound();
    launchConfetti();
    await loadElections();
  } catch(e) {
    showToast(e.code === 4001 ? "Vote cancelled." : (e.reason || e.message), "error");
  } finally {
    if (castBtn) { castBtn.disabled = false; castBtn.innerHTML = "Cast Vote →"; }
  }
}

/* ─── Vote Receipt ───────────────────────────────────────────────────────── */
function showVoteReceipt(elTitle, candidate, txHash, blockNum, gasUsed) {
  const modal = document.getElementById("voteReceiptModal");
  if (!modal) return;
  document.getElementById("voteReceiptBody").innerHTML = [
    { label:"Election",   value: elTitle },
    { label:"Your Vote",  value: candidate },
    { label:"Tx Hash",    value:`${txHash.slice(0,10)}…${txHash.slice(-6)}` },
    { label:"Block",      value:`#${blockNum}` },
    { label:"Gas Used",   value:`${parseInt(gasUsed||0).toLocaleString()} units` },
    { label:"Network",    value:"Sepolia Testnet" },
  ].map(r => `
    <div class="receipt-row">
      <span class="receipt-row-label">${r.label}</span>
      <span class="receipt-row-value">${r.value}</span>
    </div>`).join("");
  document.getElementById("voteEtherscan").href = `https://sepolia.etherscan.io/tx/${txHash}`;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closeVoteReceipt(e) {
  if (e && e.target !== document.getElementById("voteReceiptModal")) return;
  document.getElementById("voteReceiptModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

function shareVoteOnX() {
  const text = `I just voted in a blockchain election on Ethereum Sepolia! 🗳️\n\nElection: "${_lastVoteElTitle}"\nMy vote: ${_lastVoteCandidate}\n\nTamper-proof. On-chain. Verifiable.\n\n${CONFIG.BASE_URL}/voting.html\n\n#Blockchain #Web3 #Ethereum`;
  window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

/* ─── Results Section ────────────────────────────────────────────────────── */
async function loadResults() {
  const sel   = document.getElementById("resultsElectionSelect");
  const area  = document.getElementById("resultsArea");
  if (!sel || !area) return;
  const id = parseInt(sel.value);
  if (isNaN(id)) { area.innerHTML = `<div class="activity-empty">Select an election above.</div>`; return; }
  area.innerHTML = `<div class="skeleton" style="height:120px;border-radius:16px"></div>`;
  try {
    const contract = votingContract || await getReadContract();
    const el = await contract.elections(id);
    const { names, votes } = await contract.getCandidates(id);
    const total = el.totalVotes.toNumber();
    const now = Math.floor(Date.now()/1000);
    const isOpen = el.active && now <= el.endTime.toNumber();

    let winnerHTML = "";
    if (total > 0) {
      const w = await contract.getWinner(id);
      winnerHTML = `
        <div class="results-winner">
          ${w.isTie ? "🤝 Tie!" : "🏆 Leading:"}
          <strong>${escHtml(w.winnerName)}</strong>
          with ${w.winnerVotes.toNumber()} vote${w.winnerVotes.toNumber() !== 1 ? "s" : ""}
          ${!isOpen ? "(Final)" : ""}
        </div>`;
    }

    const maxV = Math.max(...votes.map(v => v.toNumber()), 1);
    area.innerHTML = `
      <div class="results-header">
        <h3 class="results-title">${escHtml(el.title)}</h3>
        <span class="election-status ${isOpen ? "status-open" : "status-closed"}">${isOpen ? "Live" : "Final"}</span>
        <span style="font-size:0.82rem;color:var(--text-muted)">${total} total votes</span>
      </div>
      ${winnerHTML}
      <div class="results-bars">
        ${names.map((n, i) => {
          const v   = votes[i].toNumber();
          const pct = total ? Math.round(v / total * 100) : 0;
          const isLeading = v === maxV && total > 0;
          return `
          <div class="result-row">
            <div class="result-label-row">
              <span class="result-name">${escHtml(n)}</span>
              <span class="result-count">${v} (${pct}%)</span>
            </div>
            <div class="result-bar-bg">
              <div class="result-bar-fill ${isLeading ? "leading" : ""}"
                style="width:0%" data-pct="${pct}"></div>
            </div>
          </div>`;
        }).join("")}
      </div>`;
    requestAnimationFrame(() => {
      area.querySelectorAll(".result-bar-fill").forEach(b => { b.style.width = b.dataset.pct + "%"; });
    });
  } catch(e) {
    area.innerHTML = `<div class="activity-empty">Error: ${e.message}</div>`;
  }
}
setInterval(() => { if (document.getElementById("resultsElectionSelect")?.value !== "") loadResults(); }, 15000);

/* ─── Verify Vote ────────────────────────────────────────────────────────── */
async function verifyVote() {
  const sel    = document.getElementById("verifyElectionSelect");
  const addrEl = document.getElementById("verifyAddress");
  const result = document.getElementById("verifyResult");
  if (!sel || !addrEl || !result) return;

  const id   = parseInt(sel.value);
  const addr = addrEl.value.trim();
  if (isNaN(id))   { showToast("Select an election.", "error"); return; }
  if (!addr || !addr.startsWith("0x")) { showToast("Enter a valid 0x address.", "error"); return; }

  result.classList.remove("hidden");
  result.innerHTML = `<div class="skeleton skeleton-line" style="width:60%"></div>`;

  try {
    const contract = votingContract || await getReadContract();
    const el = await contract.elections(id);
    const v  = await contract.getVoterChoice(id, addr);

    if (!v.voted) {
      result.innerHTML = `
        <p><strong>${addr.slice(0,10)}…</strong> has <strong>NOT voted</strong> in "${escHtml(el.title)}" yet.</p>`;
    } else {
      result.innerHTML = `
        <p>
          <strong>${addr.slice(0,10)}…</strong> voted for
          <strong style="color:var(--purple-light)">${escHtml(v.choiceName)}</strong>
          in "${escHtml(el.title)}".
        </p>
        <p style="font-size:0.78rem;color:var(--text-muted);margin-top:8px">
          Search this address on
          <a href="https://sepolia.etherscan.io/address/${addr}" target="_blank"
            style="color:var(--purple-light)">Etherscan</a>
          and look for a VoteCast transaction to the voting contract.
        </p>`;
    }
  } catch(e) {
    result.innerHTML = `<p style="color:var(--pink)">Error: ${e.message}</p>`;
  }
}

/* ─── Admin: Create Election ─────────────────────────────────────────────── */
let _electionDuration = 86400;

function setDuration(seconds, btn) {
  _electionDuration = seconds;
  document.getElementById("elDuration").value = seconds;
  document.querySelectorAll(".admin-form .filter-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
}

async function createElection() {
  if (!votingContract || !isVotingAdmin) { showToast("Admin only.", "error"); return; }
  const title = document.getElementById("elTitle")?.value.trim();
  const desc  = document.getElementById("elDesc")?.value.trim() || "";
  const raw   = document.getElementById("elCandidates")?.value || "";
  const candidates = raw.split("\n").map(s => s.trim()).filter(Boolean);
  const duration   = parseInt(document.getElementById("elDuration")?.value || "86400");

  if (!title)              { showToast("Enter a title.", "error"); return; }
  if (candidates.length < 2) { showToast("Add at least 2 candidates.", "error"); return; }
  if (candidates.length > 10){ showToast("Max 10 candidates.", "error"); return; }

  const btn = document.getElementById("createElBtn");
  if (btn) { btn.disabled = true; btn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Creating…`; }

  try {
    const tx = await votingContract.createElection(title, desc, candidates, duration);
    showToast("Transaction sent! Waiting…");
    await tx.wait();
    showToast(`Election "${title}" created! 🎉`);
    document.getElementById("elTitle").value = "";
    document.getElementById("elDesc").value  = "";
    document.getElementById("elCandidates").value = "";
    await loadElections();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg> Create Election`; }
  }
}

/* ─── Admin: Close Election ──────────────────────────────────────────────── */
async function closeElection() {
  const sel = document.getElementById("closeElectionSelect");
  const id  = parseInt(sel?.value);
  if (isNaN(id) || sel.value === "") { showToast("Select an election to close.", "error"); return; }
  if (!confirm(`Close election #${id}? This cannot be undone.`)) return;
  try {
    const tx = await votingContract.closeElection(id);
    showToast("Closing election…");
    await tx.wait();
    showToast(`Election #${id} closed.`);
    await loadElections();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  }
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function populateResultsSelects(count) {
  ["resultsElectionSelect","verifyElectionSelect"].forEach(selId => {
    const sel = document.getElementById(selId);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">Select election…</option>`;
    for (let i = count - 1; i >= 0; i--) {
      const opt = document.createElement("option");
      opt.value = i; opt.textContent = `Election #${i}`;
      sel.appendChild(opt);
    }
    if (current !== "") sel.value = current;
  });
}

function populateAdminCloseSelect(count) {
  const sel = document.getElementById("closeElectionSelect");
  if (!sel) return;
  sel.innerHTML = `<option value="">Select election…</option>`;
  for (let i = count - 1; i >= 0; i--) {
    const opt = document.createElement("option");
    opt.value = i; opt.textContent = `Election #${i}`;
    sel.appendChild(opt);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
