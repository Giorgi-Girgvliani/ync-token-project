// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MessageBoard
 * @notice Public on-chain message board. Anyone can post; admin can mark
 *         messages as deleted. IMPORTANT: "deleting" only sets a flag —
 *         the original message content lives forever in the MessagePosted
 *         event log on Etherscan, demonstrating blockchain immutability.
 * @dev Deploy in Remix: compiler 0.8.20, EVM version paris. No constructor args.
 */
contract MessageBoard {
    address public immutable admin;

    struct Message {
        uint256 id;
        address author;
        string  content;
        uint256 timestamp;
        bool    isDeleted;
    }

    Message[] private _messages;

    event MessagePosted(
        uint256 indexed id,
        address indexed author,
        string  content,
        uint256 timestamp
    );
    event MessageDeleted(uint256 indexed id, address indexed deletedBy);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Only admin");
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    /**
     * @notice Post a public message (max 280 characters).
     *         Every post is a real Ethereum transaction, permanently logged.
     */
    function post(string calldata content) external {
        require(bytes(content).length > 0,   "Cannot post empty message");
        require(bytes(content).length <= 280, "Max 280 characters");

        uint256 id = _messages.length;
        _messages.push(Message({
            id:        id,
            author:    msg.sender,
            content:   content,
            timestamp: block.timestamp,
            isDeleted: false
        }));

        emit MessagePosted(id, msg.sender, content, block.timestamp);
    }

    /**
     * @notice Admin marks a message as deleted. The message content is still
     *         visible in the original MessagePosted event on Etherscan.
     */
    function deleteMessage(uint256 id) external onlyAdmin {
        require(id < _messages.length, "Message does not exist");
        require(!_messages[id].isDeleted, "Already deleted");
        _messages[id].isDeleted = true;
        emit MessageDeleted(id, msg.sender);
    }

    /** @notice Total number of messages ever posted. */
    function getMessageCount() external view returns (uint256) {
        return _messages.length;
    }

    /** @notice Fetch a single message by id. */
    function getMessage(uint256 id) external view returns (
        address author,
        string  memory content,
        uint256 timestamp,
        bool    isDeleted
    ) {
        require(id < _messages.length, "Message does not exist");
        Message storage m = _messages[id];
        return (m.author, m.content, m.timestamp, m.isDeleted);
    }

    /**
     * @notice Fetch a batch of messages (newest first).
     * @param offset  How many messages from the end to skip (for pagination).
     * @param limit   Max number of messages to return.
     */
    function getMessages(uint256 offset, uint256 limit) external view returns (
        uint256[] memory ids,
        address[] memory authors,
        string[]  memory contents,
        uint256[] memory timestamps,
        bool[]    memory deletedFlags
    ) {
        uint256 total = _messages.length;
        if (offset >= total || limit == 0) {
            return (
                new uint256[](0), new address[](0), new string[](0),
                new uint256[](0), new bool[](0)
            );
        }
        uint256 end   = total - offset;
        uint256 start = end > limit ? end - limit : 0;
        uint256 count = end - start;

        ids          = new uint256[](count);
        authors      = new address[](count);
        contents     = new string[](count);
        timestamps   = new uint256[](count);
        deletedFlags = new bool[](count);

        for (uint256 i = 0; i < count; i++) {
            uint256 idx = end - 1 - i;   // newest first
            Message storage m = _messages[idx];
            ids[i]          = m.id;
            authors[i]      = m.author;
            contents[i]     = m.content;
            timestamps[i]   = m.timestamp;
            deletedFlags[i] = m.isDeleted;
        }
    }
}
