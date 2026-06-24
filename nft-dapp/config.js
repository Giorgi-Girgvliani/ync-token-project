// ============================================================
//  FILL THESE IN BEFORE DEPLOYING
// ============================================================

const CONFIG = {
  // Paste your ERC-721 contract address here after deploying in Remix
  NFT_CONTRACT: "0x70FC19a8f0B682c4d25Ce3ceFD107aB1AD48e335",

  // Your existing YNC ERC-20 token (already set)
  YNC_CONTRACT: "0x6601b104C3472CB3250fDB1B11b329ac81C5862A",

  // After you deploy to Cloudflare Pages, paste the URL here (no trailing slash)
  BASE_URL: "https://ync-token-project.pages.dev",

  SEPOLIA_CHAIN_ID: "0xaa36a7",   // 11155111
  MAX_SUPPLY: 5,
  MINT_PRICE_ETH: "0",            // "0" = free mint; change to "0.001" etc. if needed

  // Paste your Voting contract address here after deploying voting.sol in Remix
  VOTING_CONTRACT: "0x537109bD9703e4214C02F855493ceA378994BeAD",

  // Paste your MessageBoard contract address after deploying MessageBoard.sol
  BOARD_CONTRACT: "0xeE485252f6344975Cd2a2797dD2FE60C0185A450",

  // Paste your Lottery contract address after deploying Lottery.sol
  LOTTERY_CONTRACT: "0x41fD4183a1be0FE242702b3820bB61616ca503b7",

  // Paste your NFTAuction contract address after deploying Auction.sol
  // (constructor arg = NFT_CONTRACT address above)
  AUCTION_CONTRACT: "0xc67416276DBf36f78d605E46C3F013F03BFf3E52",

  // Unix timestamp of when the NFT contract was deployed.
  // Find it on Etherscan: open your contract → Creation Tx → check the timestamp.
  // Current estimate: June 17 2026. Update this to the exact value for accuracy.
  DEPLOY_TIMESTAMP: 1750204800,

  // Free WalletConnect / Reown project ID — get one at https://cloud.reown.com
  // Required for mobile + desktop wallet connect without a browser extension.
  WALLETCONNECT_PROJECT_ID: "55185d614644f4fc166735a14b00759b",

  // Public read-only Sepolia RPCs (no PublicNode — it blocks archive/log requests)
  SEPOLIA_RPCS: [
    "https://sepolia.drpc.org",
    "https://rpc2.sepolia.org",
    "https://1rpc.io/sepolia",
  ],
};

async function getReadProvider() {
  if (typeof ethers === "undefined") throw new Error("ethers not loaded");
  for (const url of CONFIG.SEPOLIA_RPCS) {
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

window.CONFIG = CONFIG;
