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

  // Unix timestamp of when the NFT contract was deployed.
  // Find it on Etherscan: open your contract → Creation Tx → check the timestamp.
  // Current estimate: June 17 2026. Update this to the exact value for accuracy.
  DEPLOY_TIMESTAMP: 1750204800,
};
