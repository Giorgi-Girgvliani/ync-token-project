/* ─── Message Board ABI ──────────────────────────────────────────────────── */
const BOARD_ABI = [
  "function admin() view returns (address)",
  "function getMessageCount() view returns (uint256)",
  "function getMessage(uint256 id) view returns (address author, string content, uint256 timestamp, bool isDeleted)",
  "function getMessages(uint256 offset, uint256 limit) view returns (uint256[] ids, address[] authors, string[] contents, uint256[] timestamps, bool[] deletedFlags)",
  "function post(string content)",
  "function deleteMessage(uint256 id)",
  "event MessagePosted(uint256 indexed id, address indexed author, string content, uint256 timestamp)",
  "event MessageDeleted(uint256 indexed id, address indexed deletedBy)",
];

/* ─── State ──────────────────────────────────────────────────────────────── */
let boardContract   = null;
let boardSigner     = null;
let boardUserAddr   = null;
let isBoardAdmin    = false;
let showDeleted     = false;
let boardOffset     = 0;
const BOARD_PAGE    = 20;
let totalMsgCount   = 0;
let _lastPostTxHash = null;

/* ─── Init ───────────────────────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", async () => {
  if (!CONFIG.BOARD_CONTRACT || CONFIG.BOARD_CONTRACT === "PASTE_BOARD_ADDRESS") {
    document.getElementById("boardEmpty")?.classList.remove("hidden");
    document.getElementById("boardLoading").style.display = "none";
    return;
  }
  await loadMessagesReadOnly();
  if (userAddress) await initBoardPage();
});

window.addEventListener("wallet:connected", () => initBoardPage());

async function initBoardPage() {
  if (!userAddress || !signer) return;
  try {
    boardUserAddr = userAddress;
    boardSigner   = signer;
    boardContract = new ethers.Contract(CONFIG.BOARD_CONTRACT, BOARD_ABI, signer);

    document.getElementById("boardNotConnected")?.classList.add("hidden");
    document.getElementById("boardConnected")?.classList.remove("hidden");
    const walletEl = document.getElementById("boardWalletShort");
    if (walletEl) walletEl.textContent = getDisplayName?.(boardUserAddr) || `${boardUserAddr.slice(0,6)}…${boardUserAddr.slice(-4)}`;

    const postBtn = document.getElementById("postBtn");
    if (postBtn) postBtn.disabled = false;

    const adminAddr = await boardContract.admin();
    isBoardAdmin = adminAddr.toLowerCase() === boardUserAddr.toLowerCase();
    if (isBoardAdmin) document.getElementById("boardAdminBadge")?.classList.remove("hidden");

    await loadMessages();
  } catch(e) {
    showToast("Connect failed: " + (e.message || e), "error");
  }
}

/* ─── Load messages ──────────────────────────────────────────────────────── */
async function loadMessagesReadOnly() {
  if (!CONFIG.BOARD_CONTRACT || CONFIG.BOARD_CONTRACT === "PASTE_BOARD_ADDRESS") return;
  try {
    const p   = await getReadProvider();
    const con = new ethers.Contract(CONFIG.BOARD_CONTRACT, BOARD_ABI, p);
    totalMsgCount = (await con.getMessageCount()).toNumber();
    await renderMessages(con, 0);
  } catch(e) {
    document.getElementById("boardLoading").style.display = "none";
  }
}

async function loadMessages() {
  boardOffset = 0;
  document.getElementById("boardList").innerHTML = "";
  document.getElementById("boardEmpty")?.classList.add("hidden");
  document.getElementById("boardLoading").style.display = "";
  document.getElementById("boardLoadMore")?.classList.add("hidden");

  try {
    const con = boardContract || await getBoardReadContract();
    totalMsgCount = (await con.getMessageCount()).toNumber();
    document.getElementById("boardLoading").style.display = "none";

    const label = document.getElementById("msgCountLabel");
    if (label) label.textContent = `${totalMsgCount} message${totalMsgCount !== 1 ? "s" : ""} on-chain`;

    if (totalMsgCount === 0) {
      document.getElementById("boardEmpty")?.classList.remove("hidden");
      return;
    }
    await renderMessages(con, 0);
  } catch(e) {
    document.getElementById("boardLoading").style.display = "none";
    const isCallEx = e.code === "CALL_EXCEPTION" || e.message?.includes("CALL_EXCEPTION");
    document.getElementById("boardList").innerHTML = `
      <div class="activity-empty">
        ${isCallEx
          ? `Contract not found on Sepolia. Make sure you deployed on <strong>Injected Provider</strong> (not Remix VM).<br/>
             <a href="https://sepolia.etherscan.io/address/${CONFIG.BOARD_CONTRACT}" target="_blank"
               style="color:var(--purple-light)">Check on Etherscan ↗</a>`
          : `Error loading: ${e.message}`
        }
      </div>`;
  }
}

async function loadMoreMessages() {
  boardOffset += BOARD_PAGE;
  const con = boardContract || await getBoardReadContract();
  await renderMessages(con, boardOffset);
}

async function renderMessages(con, offset) {
  const list = document.getElementById("boardList");
  try {
    const res = await con.getMessages(offset, BOARD_PAGE);
    const { ids, authors, contents, timestamps, deletedFlags } = res;

    if (ids.length === 0) {
      document.getElementById("boardLoadMore")?.classList.add("hidden");
      return;
    }

    for (let i = 0; i < ids.length; i++) {
      if (!showDeleted && deletedFlags[i]) continue;
      const card = buildMessageCard(ids[i].toNumber(), authors[i], contents[i], timestamps[i].toNumber(), deletedFlags[i]);
      list.appendChild(card);
    }

    const nextOffset = offset + BOARD_PAGE;
    const btn = document.getElementById("boardLoadMore");
    if (btn) {
      btn.classList.toggle("hidden", nextOffset >= totalMsgCount);
    }

    requestAnimationFrame(() => {
      list.querySelectorAll(".board-msg-card:not(.visible)").forEach(c => c.classList.add("visible"));
    });
  } catch(e) {
    list.innerHTML += `<div class="activity-empty">Error: ${e.message}</div>`;
  }
}

function buildMessageCard(id, author, content, timestamp, isDeleted) {
  const card = document.createElement("div");
  card.className = "board-msg-card reveal" + (isDeleted ? " board-msg-deleted" : "");
  card.dataset.msgId = id;

  const isOwnMsg = boardUserAddr && author.toLowerCase() === boardUserAddr.toLowerCase();
  const ts = new Date(timestamp * 1000);
  const timeStr = ts.toLocaleString();

  const shortAuthor = `${author.slice(0,6)}…${author.slice(-4)}`;
  const etherscanUrl = `https://sepolia.etherscan.io/address/${author}`;

  card.innerHTML = `
    <div class="board-msg-header">
      <div class="board-msg-author-row">
        <span class="board-msg-avatar" style="background:${addrToColor(author)}">
          ${author.slice(2,4).toUpperCase()}
        </span>
        <div>
          <a href="${etherscanUrl}" target="_blank" class="board-msg-author mono"
            title="${author}">${shortAuthor}</a>
          ${isOwnMsg ? `<span class="board-you-tag">You</span>` : ""}
          <div class="board-msg-time">${timeStr}</div>
        </div>
      </div>
      <div class="board-msg-actions">
        ${isDeleted ? "" : `<a href="https://sepolia.etherscan.io/search?f=0&q=${encodeURIComponent(content.slice(0,20))}" target="_blank" class="board-etherscan-link" title="Find on Etherscan">↗</a>`}
        ${isBoardAdmin && !isDeleted ? `<button class="board-delete-btn" onclick="deleteMessage(${id})" title="Remove message">✕</button>` : ""}
      </div>
    </div>
    ${isDeleted
      ? `<p class="board-msg-content board-deleted-content">[This message was removed by admin. The original content is permanently visible on Etherscan in the MessagePosted event.]</p>`
      : `<p class="board-msg-content">${escHtml(content)}</p>`
    }
    <div class="board-msg-footer">
      <span class="board-msg-id mono">#${id}</span>
      ${isDeleted ? `<span class="board-deleted-badge">Removed</span>` : ""}
    </div>
  `;
  return card;
}

/* ─── Post ───────────────────────────────────────────────────────────────── */
function updateCharCount() {
  const ta = document.getElementById("msgContent");
  const count = document.getElementById("charCount");
  const postBtn = document.getElementById("postBtn");
  if (!ta || !count) return;
  const len = ta.value.length;
  count.textContent = `${len} / 280`;
  count.style.color = len > 260 ? "#ef4444" : len > 200 ? "#f59e0b" : "";
  if (postBtn) postBtn.disabled = len === 0 || !boardUserAddr;
}

async function publishBoardMessage() {
  const ta = document.getElementById("msgContent");
  const content = ta?.value.trim();
  if (!content)        { showToast("Write something first.", "error"); return; }
  if (!boardContract)  { showToast("Connect wallet first.", "error"); return; }

  const postBtn = document.getElementById("postBtn");
  if (postBtn) { postBtn.disabled = true; postBtn.innerHTML = `<div class="spinner" style="width:16px;height:16px;margin:0"></div> Posting…`; }

  try {
    const tx = await boardContract.post(content);
    showToast("Transaction sent! Waiting for confirmation…");
    const receipt = await tx.wait();
    _lastPostTxHash = tx.hash;

    if (ta) ta.value = "";
    updateCharCount();
    showPostReceipt(content, tx.hash, receipt.blockNumber);
    playMintSound();
    await loadMessages();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  } finally {
    if (postBtn) {
      postBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg> Post to Chain`;
      postBtn.disabled = false;
    }
  }
}

/* ─── Delete (admin) ─────────────────────────────────────────────────────── */
async function deleteMessage(id) {
  if (!isBoardAdmin || !boardContract) return;
  if (!confirm(`Remove message #${id}?\n\nNote: The original message content will still be visible on Etherscan in the event log — this only hides it from the UI.`)) return;

  try {
    const tx = await boardContract.deleteMessage(id);
    showToast("Removing message…");
    await tx.wait();
    showToast(`Message #${id} removed. (Still on Etherscan forever 👀)`);
    await loadMessages();
  } catch(e) {
    showToast(e.code === 4001 ? "Cancelled." : (e.reason || e.message), "error");
  }
}

/* ─── Toggle show deleted ────────────────────────────────────────────────── */
function toggleShowDeleted() {
  showDeleted = !showDeleted;
  const toggle = document.getElementById("showDeletedToggle");
  if (toggle) toggle.textContent = showDeleted ? "Hide removed" : "Show removed";
  loadMessages();
}

/* ─── Receipt ────────────────────────────────────────────────────────────── */
function showPostReceipt(content, txHash, blockNum) {
  const modal = document.getElementById("postReceiptModal");
  if (!modal) return;
  const preview = content.length > 60 ? content.slice(0,60) + "…" : content;
  document.getElementById("postReceiptBody").innerHTML = [
    { label:"Message",  value: preview },
    { label:"Tx Hash",  value:`${txHash.slice(0,10)}…${txHash.slice(-6)}` },
    { label:"Block",    value:`#${blockNum}` },
    { label:"Author",   value:`${boardUserAddr.slice(0,6)}…${boardUserAddr.slice(-4)}` },
    { label:"Network",  value:"Sepolia Testnet" },
  ].map(r => `
    <div class="receipt-row">
      <span class="receipt-row-label">${r.label}</span>
      <span class="receipt-row-value">${r.value}</span>
    </div>`).join("");
  document.getElementById("postEtherscan").href = `https://sepolia.etherscan.io/tx/${txHash}`;
  modal.classList.remove("hidden");
  document.body.style.overflow = "hidden";
}

function closePostReceipt(e) {
  if (e && e.target !== document.getElementById("postReceiptModal")) return;
  document.getElementById("postReceiptModal")?.classList.add("hidden");
  document.body.style.overflow = "";
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */
async function getBoardReadContract() {
  const p = await getReadProvider();
  return new ethers.Contract(CONFIG.BOARD_CONTRACT, BOARD_ABI, p);
}

function addrToColor(addr) {
  const hue = parseInt(addr.slice(2,6), 16) % 360;
  return `hsl(${hue},60%,35%)`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;")
    .replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
