/* Gallery leaderboard — self-contained; overrides cached script.js RPC + loadLeaderboard */
(function () {
  const LEADERBOARD_RPCS = [
    "https://sepolia.drpc.org",
    "https://rpc2.sepolia.org",
    "https://1rpc.io/sepolia",
  ];

  const LEADERBOARD_ABI = [
    "function totalSupply() view returns (uint256)",
    "function ownerOf(uint256 tokenId) view returns (address)",
  ];

  async function getLeaderboardProvider() {
    for (const url of LEADERBOARD_RPCS) {
      try {
        const p = new ethers.providers.JsonRpcProvider(url);
        await Promise.race([
          p.getBlockNumber(),
          new Promise((_, r) => setTimeout(() => r(new Error("timeout")), 4000)),
        ]);
        return p;
      } catch { /* try next */ }
    }
    throw new Error("All Sepolia RPC endpoints unreachable.");
  }

  // Override any cached script.js provider that still points at PublicNode
  window.getReadProvider = getLeaderboardProvider;

  window.loadLeaderboard = async function loadLeaderboard() {
    const el = document.getElementById("leaderboard");
    if (!el || typeof ethers === "undefined") return;
    if (CONFIG.NFT_CONTRACT === "PASTE_YOUR_NFT_CONTRACT_ADDRESS") {
      el.innerHTML = `<div class="activity-empty">Set NFT contract in config.js first.</div>`;
      return;
    }
    el.innerHTML = `<div style="display:flex;gap:12px">
      <div class="skeleton skeleton-card" style="height:56px;flex:1"></div>
      <div class="skeleton skeleton-card" style="height:56px;flex:1"></div>
    </div>`;
    try {
      const p = await getLeaderboardProvider();
      const con = new ethers.Contract(CONFIG.NFT_CONTRACT, LEADERBOARD_ABI, p);
      const total = (await con.totalSupply()).toNumber();
      if (!total) {
        el.innerHTML = `<div class="activity-empty">No NFTs minted yet.</div>`;
        return;
      }

      const owners = await Promise.all(
        Array.from({ length: total }, (_, i) => con.ownerOf(i + 1))
      );
      const ownerMap = {};
      owners.forEach(o => {
        const addr = o.toLowerCase();
        ownerMap[addr] = (ownerMap[addr] || 0) + 1;
      });

      const sorted = Object.entries(ownerMap).sort((a, b) => b[1] - a[1]);
      if (!sorted.length) {
        el.innerHTML = `<div class="activity-empty">No data yet.</div>`;
        return;
      }

      const rankClass = ["gold", "silver", "bronze"];
      el.innerHTML = sorted.map(([addr, count], i) => `
        <div class="lb-item">
          <div class="lb-rank ${rankClass[i] || "other"}">${i + 1}</div>
          <span class="lb-addr">${addr.slice(0, 8)}…${addr.slice(-4)}</span>
          <span class="lb-count">${count} NFT${count > 1 ? "s" : ""}</span>
        </div>`).join("");
    } catch (e) {
      el.innerHTML = `<div class="activity-empty">Error: ${e.message}</div>`;
    }
  };
})();

setTimeout(() => {
  if (document.getElementById("leaderboard")) window.loadLeaderboard();
}, 2000);
