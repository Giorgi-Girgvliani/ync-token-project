// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BlockchainLottery
 * @notice Transparent, trustless lottery on Ethereum. Admin starts rounds and
 *         funds the prize pool; participants enter for free (1 entry / address);
 *         admin draws winner using on-chain randomness (block.prevrandao + keccak256).
 *
 * @dev Deploy in Remix: compiler 0.8.20, EVM version paris. No constructor args.
 *
 * Security note: block.prevrandao (EIP-4399) is pseudo-random and sufficient
 * for a demo / low-stakes lottery. For production high-value lotteries use
 * Chainlink VRF for provably fair randomness.
 */
contract BlockchainLottery {
    address public immutable admin;

    struct Round {
        uint256   id;
        uint256   prize;        // wei
        address   winner;
        bool      drawn;
        uint256   startTime;
        uint256   playerCount;
    }

    Round[]    private _rounds;
    mapping(uint256 => address[]) private _players;
    mapping(uint256 => mapping(address => bool)) public hasEntered;

    event RoundStarted(uint256 indexed roundId, uint256 prize);
    event PlayerEntered(uint256 indexed roundId, address indexed player);
    event WinnerDrawn(uint256 indexed roundId, address indexed winner, uint256 prize);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    modifier roundExists(uint256 id) {
        require(id < _rounds.length, "Round does not exist");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /**
     * @notice Admin starts a new lottery round and optionally funds the prize.
     *         Send ETH with this call to fund the prize pool.
     */
    function startRound() external payable onlyAdmin {
        uint256 id = _rounds.length;
        _rounds.push(Round({
            id:          id,
            prize:       msg.value,
            winner:      address(0),
            drawn:       false,
            startTime:   block.timestamp,
            playerCount: 0
        }));
        emit RoundStarted(id, msg.value);
    }

    /**
     * @notice Enter the current (latest) open round. Free — one entry per address.
     */
    function enter() external {
        uint256 id = currentRoundId();
        require(id < _rounds.length, "No active round");
        Round storage r = _rounds[id];
        require(!r.drawn,                    "Round already drawn");
        require(!hasEntered[id][msg.sender], "Already entered this round");
        require(_players[id].length < 500,   "Round is full");

        hasEntered[id][msg.sender] = true;
        _players[id].push(msg.sender);
        r.playerCount++;
        emit PlayerEntered(id, msg.sender);
    }

    /**
     * @notice Admin draws a winner for the specified round.
     *         Uses block.prevrandao + keccak256 for unpredictable selection.
     */
    function drawWinner(uint256 roundId) external onlyAdmin roundExists(roundId) {
        Round storage r = _rounds[roundId];
        require(!r.drawn,                   "Already drawn");
        require(_players[roundId].length > 0, "No players entered");

        uint256 rand = uint256(keccak256(abi.encodePacked(
            block.prevrandao,
            block.timestamp,
            _players[roundId].length,
            roundId
        )));
        uint256 idx = rand % _players[roundId].length;
        address winner = _players[roundId][idx];

        r.winner = winner;
        r.drawn  = true;

        emit WinnerDrawn(roundId, winner, r.prize);

        if (r.prize > 0) {
            (bool ok,) = winner.call{value: r.prize}("");
            require(ok, "Prize transfer failed");
        }
    }

    /* ─── Views ─────────────────────────────────────────────────────────── */

    /** @notice Returns the ID of the latest round (may or may not be active). */
    function currentRoundId() public view returns (uint256) {
        return _rounds.length == 0 ? 0 : _rounds.length - 1;
    }

    function getRoundCount() external view returns (uint256) {
        return _rounds.length;
    }

    function getRound(uint256 id) external view roundExists(id) returns (
        uint256 prize,
        address winner,
        bool    drawn,
        uint256 startTime,
        uint256 playerCount
    ) {
        Round storage r = _rounds[id];
        return (r.prize, r.winner, r.drawn, r.startTime, r.playerCount);
    }

    function getPlayers(uint256 roundId) external view roundExists(roundId) returns (address[] memory) {
        return _players[roundId];
    }

    /** @notice Check whether address is in the current open round. */
    function isEntered(address who) external view returns (bool) {
        uint256 id = _rounds.length == 0 ? 0 : _rounds.length - 1;
        if (_rounds.length == 0) return false;
        return hasEntered[id][who];
    }

    receive() external payable {}
}
