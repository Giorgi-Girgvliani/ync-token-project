// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title BlockchainVoting
 * @author Giorgi Girgvliani
 * @notice Tamper-proof on-chain voting system on Ethereum Sepolia.
 *         Admin creates elections with candidates and a duration.
 *         Each wallet address may cast exactly one vote per election.
 *         All votes and results are publicly verifiable on Etherscan.
 *
 * Deploy steps (Remix):
 *   1. Compiler: 0.8.20  |  EVM: paris  |  Language: Solidity
 *   2. Deploy with no constructor arguments
 *   3. The deploying wallet becomes the immutable admin
 */
contract BlockchainVoting {

    /* ─── Data Structures ──────────────────────────────────────────────── */

    struct Candidate {
        string   name;
        uint256  voteCount;
    }

    struct Election {
        string   title;
        string   description;
        uint256  startTime;
        uint256  endTime;
        bool     active;
        uint256  totalVotes;
    }

    /* ─── State ─────────────────────────────────────────────────────────── */

    address public immutable admin;

    Election[] public elections;

    /// electionId → list of candidates
    mapping(uint256 => Candidate[]) private _candidates;

    /// electionId → voter address → has voted?
    mapping(uint256 => mapping(address => bool)) private _hasVoted;

    /// electionId → voter address → candidate index they chose
    mapping(uint256 => mapping(address => uint256)) private _voterChoice;

    /* ─── Events ────────────────────────────────────────────────────────── */

    event ElectionCreated(
        uint256 indexed electionId,
        string  title,
        address indexed creator,
        uint256 endTime
    );

    event VoteCast(
        uint256 indexed electionId,
        address indexed voter,
        uint256 candidateIndex,
        string  candidateName
    );

    event ElectionClosed(uint256 indexed electionId, string title);

    /* ─── Modifiers ─────────────────────────────────────────────────────── */

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin can call this");
        _;
    }

    modifier exists(uint256 electionId) {
        require(electionId < elections.length, "Election does not exist");
        _;
    }

    /* ─── Constructor ───────────────────────────────────────────────────── */

    constructor() {
        admin = msg.sender;
    }

    /* ─── Admin Functions ───────────────────────────────────────────────── */

    /**
     * @notice Create a new election.
     * @param title           Short title, e.g. "Best Programming Language"
     * @param description     Longer context shown to voters
     * @param candidateNames  At least 2, at most 10 candidate names
     * @param durationSeconds How long voting is open (max 7 days = 604800 s)
     */
    function createElection(
        string   calldata title,
        string   calldata description,
        string[] calldata candidateNames,
        uint256  durationSeconds
    ) external onlyAdmin {
        require(bytes(title).length > 0,        "Title is required");
        require(candidateNames.length >= 2,     "Need at least 2 candidates");
        require(candidateNames.length <= 10,    "Maximum 10 candidates");
        require(durationSeconds >= 60,          "Duration must be at least 60 seconds");
        require(durationSeconds <= 7 days,      "Duration must be at most 7 days");

        uint256 electionId = elections.length;

        elections.push(Election({
            title:       title,
            description: description,
            startTime:   block.timestamp,
            endTime:     block.timestamp + durationSeconds,
            active:      true,
            totalVotes:  0
        }));

        for (uint256 i = 0; i < candidateNames.length; i++) {
            require(bytes(candidateNames[i]).length > 0, "Candidate name cannot be empty");
            _candidates[electionId].push(Candidate({
                name:      candidateNames[i],
                voteCount: 0
            }));
        }

        emit ElectionCreated(electionId, title, msg.sender, block.timestamp + durationSeconds);
    }

    /**
     * @notice Manually close an election before its end time.
     */
    function closeElection(uint256 electionId) external onlyAdmin exists(electionId) {
        require(elections[electionId].active, "Already closed");
        elections[electionId].active = false;
        emit ElectionClosed(electionId, elections[electionId].title);
    }

    /* ─── Voter Functions ───────────────────────────────────────────────── */

    /**
     * @notice Cast your vote. Each address can vote once per election.
     * @param electionId     The election to vote in
     * @param candidateIndex 0-based index of your chosen candidate
     */
    function vote(uint256 electionId, uint256 candidateIndex) external exists(electionId) {
        Election storage el = elections[electionId];

        require(el.active,                              "Election is not active");
        require(block.timestamp >= el.startTime,        "Election has not started");
        require(block.timestamp <= el.endTime,          "Election has ended");
        require(!_hasVoted[electionId][msg.sender],     "You have already voted");
        require(candidateIndex < _candidates[electionId].length, "Invalid candidate index");

        _hasVoted[electionId][msg.sender]      = true;
        _voterChoice[electionId][msg.sender]   = candidateIndex;
        _candidates[electionId][candidateIndex].voteCount++;
        el.totalVotes++;

        emit VoteCast(
            electionId,
            msg.sender,
            candidateIndex,
            _candidates[electionId][candidateIndex].name
        );
    }

    /* ─── View Functions ────────────────────────────────────────────────── */

    function getElectionCount() external view returns (uint256) {
        return elections.length;
    }

    /**
     * @notice Get all candidate names and their vote counts for an election.
     */
    function getCandidates(uint256 electionId)
        external view exists(electionId)
        returns (string[] memory names, uint256[] memory votes)
    {
        Candidate[] storage cands = _candidates[electionId];
        names = new string[](cands.length);
        votes = new uint256[](cands.length);
        for (uint256 i = 0; i < cands.length; i++) {
            names[i] = cands[i].name;
            votes[i] = cands[i].voteCount;
        }
    }

    /**
     * @notice Check how a specific address voted.
     */
    function getVoterChoice(uint256 electionId, address voter)
        external view exists(electionId)
        returns (bool voted, uint256 choiceIndex, string memory choiceName)
    {
        voted = _hasVoted[electionId][voter];
        if (voted) {
            choiceIndex = _voterChoice[electionId][voter];
            choiceName  = _candidates[electionId][choiceIndex].name;
        }
    }

    /**
     * @notice Compute the current winner (or detect a tie).
     */
    function getWinner(uint256 electionId)
        external view exists(electionId)
        returns (string memory winnerName, uint256 winnerVotes, bool isTie)
    {
        Candidate[] storage cands = _candidates[electionId];
        require(cands.length > 0, "No candidates");
        uint256 maxVotes    = 0;
        uint256 winnerIndex = 0;
        uint256 tieCount    = 0;

        for (uint256 i = 0; i < cands.length; i++) {
            if (cands[i].voteCount > maxVotes) {
                maxVotes    = cands[i].voteCount;
                winnerIndex = i;
                tieCount    = 1;
            } else if (cands[i].voteCount == maxVotes && maxVotes > 0) {
                tieCount++;
            }
        }

        winnerName  = cands[winnerIndex].name;
        winnerVotes = maxVotes;
        isTie       = tieCount > 1;
    }

    /**
     * @notice Check whether an election is still accepting votes right now.
     */
    function isVotingOpen(uint256 electionId)
        external view exists(electionId)
        returns (bool)
    {
        Election storage el = elections[electionId];
        return el.active
            && block.timestamp >= el.startTime
            && block.timestamp <= el.endTime;
    }
}
