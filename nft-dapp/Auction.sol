// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title NFTAuction
 * @notice English auction house for the idkSomething NFT collection.
 *         Admin creates auctions for token IDs; bidders compete; highest
 *         bidder wins the NFT when time runs out.
 *
 * @dev Deploy in Remix: compiler 0.8.20, EVM version paris.
 *      Constructor argument: the NFT contract address
 *      (0x70FC19a8f0B682c4d25Ce3ceFD107aB1AD48e335).
 *
 *      Before calling createAuction(tokenId, duration):
 *        1. In the NFT contract call approve(auctionContractAddress, tokenId)
 *        2. Then call createAuction — the auction contract will pull the NFT.
 *
 *      Outbid funds are held in pendingReturns; call withdraw() to reclaim ETH.
 */

interface IERC721Transfer {
    function transferFrom(address from, address to, uint256 tokenId) external;
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
}

contract NFTAuction {
    address          public immutable admin;
    IERC721Transfer  public immutable nft;

    struct Auction {
        uint256 tokenId;
        address seller;
        address highestBidder;
        uint256 highestBid;
        uint256 endTime;
        bool    active;
        bool    settled;
    }

    Auction[] private _auctions;

    // auctionId → bidder → claimable ETH (outbid refunds)
    mapping(uint256 => mapping(address => uint256)) public pendingReturns;

    event AuctionCreated(uint256 indexed auctionId, uint256 tokenId, uint256 endTime);
    event BidPlaced(uint256 indexed auctionId, address indexed bidder, uint256 amount);
    event AuctionEnded(uint256 indexed auctionId, address winner, uint256 amount, uint256 tokenId);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier exists(uint256 id) {
        require(id < _auctions.length, "Auction not found");
        _;
    }

    constructor(address _nft) {
        admin = msg.sender;
        nft   = IERC721Transfer(_nft);
    }

    /**
     * @notice Create a new auction for an NFT token.
     * @param tokenId          Token to auction (must be owned by admin & approved).
     * @param durationSeconds  How long the auction runs.
     *
     * Before calling: nftContract.approve(address(this), tokenId)
     */
    function createAuction(uint256 tokenId, uint256 durationSeconds) external onlyAdmin {
        require(nft.ownerOf(tokenId) == msg.sender,        "You must own the token");
        require(nft.getApproved(tokenId) == address(this), "Auction contract not approved");
        require(durationSeconds >= 60,                      "Min 60 seconds");

        // Pull the NFT into escrow
        nft.transferFrom(msg.sender, address(this), tokenId);

        uint256 id = _auctions.length;
        _auctions.push(Auction({
            tokenId:       tokenId,
            seller:        msg.sender,
            highestBidder: address(0),
            highestBid:    0,
            endTime:       block.timestamp + durationSeconds,
            active:        true,
            settled:       false
        }));

        emit AuctionCreated(id, tokenId, block.timestamp + durationSeconds);
    }

    /**
     * @notice Place a bid. Must exceed the current highest bid.
     *         Outbid funds are recorded in pendingReturns.
     */
    function bid(uint256 auctionId) external payable exists(auctionId) {
        Auction storage a = _auctions[auctionId];
        require(a.active,                       "Auction not active");
        require(block.timestamp <= a.endTime,   "Auction ended");
        require(msg.value > a.highestBid,       "Bid too low");
        require(msg.sender != a.seller,         "Seller cannot bid");

        if (a.highestBidder != address(0)) {
            pendingReturns[auctionId][a.highestBidder] += a.highestBid;
        }

        a.highestBidder = msg.sender;
        a.highestBid    = msg.value;

        emit BidPlaced(auctionId, msg.sender, msg.value);
    }

    /**
     * @notice Settle an auction after its end time.
     *         Anyone can call this — no trust required.
     */
    function endAuction(uint256 auctionId) external exists(auctionId) {
        Auction storage a = _auctions[auctionId];
        require(a.active, "Already settled");
        require(
            block.timestamp > a.endTime || msg.sender == admin,
            "Auction still running"
        );

        a.active   = false;
        a.settled  = true;

        if (a.highestBidder != address(0)) {
            // Transfer NFT to winner
            nft.transferFrom(address(this), a.highestBidder, a.tokenId);
            // Transfer ETH to seller
            (bool ok,) = a.seller.call{value: a.highestBid}("");
            require(ok, "ETH transfer to seller failed");
            emit AuctionEnded(auctionId, a.highestBidder, a.highestBid, a.tokenId);
        } else {
            // No bids — return NFT to seller
            nft.transferFrom(address(this), a.seller, a.tokenId);
            emit AuctionEnded(auctionId, address(0), 0, a.tokenId);
        }
    }

    /**
     * @notice Admin can cancel an auction (no bids required; returns NFT).
     */
    function cancelAuction(uint256 auctionId) external onlyAdmin exists(auctionId) {
        Auction storage a = _auctions[auctionId];
        require(a.active, "Already settled or cancelled");
        require(a.highestBidder == address(0), "Cannot cancel: bids exist");

        a.active  = false;
        a.settled = true;
        nft.transferFrom(address(this), a.seller, a.tokenId);
        emit AuctionEnded(auctionId, address(0), 0, a.tokenId);
    }

    /**
     * @notice Claim your outbid ETH refund.
     */
    function withdraw(uint256 auctionId) external {
        uint256 amount = pendingReturns[auctionId][msg.sender];
        require(amount > 0, "Nothing to withdraw");
        pendingReturns[auctionId][msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    /* ─── Views ─────────────────────────────────────────────────────────── */

    function getAuctionCount() external view returns (uint256) {
        return _auctions.length;
    }

    function getAuction(uint256 id) external view exists(id) returns (
        uint256 tokenId,
        address seller,
        address highestBidder,
        uint256 highestBid,
        uint256 endTime,
        bool    active,
        bool    settled
    ) {
        Auction storage a = _auctions[id];
        return (
            a.tokenId, a.seller, a.highestBidder, a.highestBid,
            a.endTime, a.active, a.settled
        );
    }
}
