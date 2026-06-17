// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ─── DEPLOY STEPS IN REMIX ────────────────────────────────────────────────
// 1. Paste this file into Remix (remix.ethereum.org)
// 2. Compiler tab → 0.8.20, EVM: paris (or default), Language: Solidity
// 3. Click Compile — should go green with NO errors
// 4. Deploy tab → Environment: Injected Provider - MetaMask (Sepolia)
// 5. Constructor fields:
//      _baseURI  → https://ync-token-project.pages.dev/metadata/
// 6. Deploy → confirm MetaMask → copy the contract address
// 7. Paste address into config.js  NFT_CONTRACT field
// ──────────────────────────────────────────────────────────────────────────

contract idkSomethingNFT {

    // ── ERC-165 ──────────────────────────────────────────────────────────
    bytes4 private constant INTERFACE_ERC165      = 0x01ffc9a7;
    bytes4 private constant INTERFACE_ERC721      = 0x80ac58cd;
    bytes4 private constant INTERFACE_ERC721META  = 0x5b5e139f;
    bytes4 private constant INTERFACE_ERC721ENUM  = 0x780e9d63;

    // ── Storage ───────────────────────────────────────────────────────────
    string  public  name     = "idkSomething NFTs";
    string  public  symbol   = "YNCNFT";
    address public  owner;

    uint256 public  maxSupply   = 5;
    uint256 private _nextId     = 1;
    string  private _baseURI;

    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;
    mapping(uint256 => address) private _tokenApprovals;
    mapping(address => mapping(address => bool)) private _operatorApprovals;

    // Enumerable
    uint256[] private _allTokens;
    mapping(address => uint256[]) private _ownedTokens;
    mapping(uint256 => uint256)   private _ownedTokensIndex;
    mapping(uint256 => uint256)   private _allTokensIndex;

    // ── Events ────────────────────────────────────────────────────────────
    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event Approval(address indexed owner_, address indexed approved, uint256 indexed tokenId);
    event ApprovalForAll(address indexed owner_, address indexed operator, bool approved);
    event Minted(address indexed to, uint256 tokenId);

    // ── Constructor ───────────────────────────────────────────────────────
    constructor(string memory baseURI_) {
        owner    = msg.sender;
        _baseURI = baseURI_;
    }

    // ── Modifiers ─────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    // ── ERC-165 ───────────────────────────────────────────────────────────
    function supportsInterface(bytes4 id) public pure returns (bool) {
        return id == INTERFACE_ERC165
            || id == INTERFACE_ERC721
            || id == INTERFACE_ERC721META
            || id == INTERFACE_ERC721ENUM;
    }

    // ── ERC-721 view ──────────────────────────────────────────────────────
    function balanceOf(address addr) public view returns (uint256) {
        require(addr != address(0), "Zero address");
        return _balances[addr];
    }

    function ownerOf(uint256 tokenId) public view returns (address) {
        address o = _owners[tokenId];
        require(o != address(0), "Token does not exist");
        return o;
    }

    function getApproved(uint256 tokenId) public view returns (address) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return _tokenApprovals[tokenId];
    }

    function isApprovedForAll(address owner_, address operator) public view returns (bool) {
        return _operatorApprovals[owner_][operator];
    }

    // ── ERC-721 metadata ──────────────────────────────────────────────────
    function tokenURI(uint256 tokenId) public view returns (string memory) {
        require(_owners[tokenId] != address(0), "Token does not exist");
        return string(abi.encodePacked(_baseURI, _toString(tokenId), ".json"));
    }

    // ── ERC-721 approval / transfer ───────────────────────────────────────
    function approve(address to, uint256 tokenId) public {
        address o = ownerOf(tokenId);
        require(msg.sender == o || isApprovedForAll(o, msg.sender), "Not authorized");
        _tokenApprovals[tokenId] = to;
        emit Approval(o, to, tokenId);
    }

    function setApprovalForAll(address operator, bool approved) public {
        _operatorApprovals[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function transferFrom(address from, address to, uint256 tokenId) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        _transfer(from, to, tokenId);
    }

    function safeTransferFrom(address from, address to, uint256 tokenId) public {
        safeTransferFrom(from, to, tokenId, "");
    }

    function safeTransferFrom(address from, address to, uint256 tokenId, bytes memory data) public {
        require(_isApprovedOrOwner(msg.sender, tokenId), "Not authorized");
        _transfer(from, to, tokenId);
        require(_checkOnERC721Received(from, to, tokenId, data), "Transfer to non ERC721Receiver");
    }

    // ── ERC-721 Enumerable ────────────────────────────────────────────────
    function totalSupply() public view returns (uint256) {
        return _allTokens.length;
    }

    function tokenByIndex(uint256 index) public view returns (uint256) {
        require(index < _allTokens.length, "Out of bounds");
        return _allTokens[index];
    }

    function tokenOfOwnerByIndex(address addr, uint256 index) public view returns (uint256) {
        require(index < _balances[addr], "Out of bounds");
        return _ownedTokens[addr][index];
    }

    // ── Mint ──────────────────────────────────────────────────────────────
    function mint() external {
        require(_nextId <= maxSupply, "Max supply reached");
        uint256 tokenId = _nextId;
        _nextId++;
        _safeMintInternal(msg.sender, tokenId);
        emit Minted(msg.sender, tokenId);
    }

    // ── Owner functions ───────────────────────────────────────────────────
    function setBaseURI(string memory newURI) external onlyOwner {
        _baseURI = newURI;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    // ── Internal helpers ──────────────────────────────────────────────────
    function _safeMintInternal(address to, uint256 tokenId) internal {
        _mintInternal(to, tokenId);
        require(_checkOnERC721Received(address(0), to, tokenId, ""), "Transfer to non ERC721Receiver");
    }

    function _mintInternal(address to, uint256 tokenId) internal {
        require(to != address(0), "Mint to zero address");
        require(_owners[tokenId] == address(0), "Already minted");

        _balances[to]++;
        _owners[tokenId] = to;

        // Enumerable bookkeeping
        _ownedTokensIndex[tokenId] = _ownedTokens[to].length;
        _ownedTokens[to].push(tokenId);
        _allTokensIndex[tokenId] = _allTokens.length;
        _allTokens.push(tokenId);

        emit Transfer(address(0), to, tokenId);
    }

    function _transfer(address from, address to, uint256 tokenId) internal {
        require(ownerOf(tokenId) == from, "Wrong owner");
        require(to != address(0), "Transfer to zero address");

        delete _tokenApprovals[tokenId];

        // Enumerable: remove from sender
        uint256 lastIndex = _ownedTokens[from].length - 1;
        uint256 tokenIndex = _ownedTokensIndex[tokenId];
        if (tokenIndex != lastIndex) {
            uint256 lastTokenId = _ownedTokens[from][lastIndex];
            _ownedTokens[from][tokenIndex] = lastTokenId;
            _ownedTokensIndex[lastTokenId] = tokenIndex;
        }
        _ownedTokens[from].pop();

        // Enumerable: add to receiver
        _ownedTokensIndex[tokenId] = _ownedTokens[to].length;
        _ownedTokens[to].push(tokenId);

        _balances[from]--;
        _balances[to]++;
        _owners[tokenId] = to;

        emit Transfer(from, to, tokenId);
    }

    function _isApprovedOrOwner(address spender, uint256 tokenId) internal view returns (bool) {
        address o = ownerOf(tokenId);
        return (spender == o || getApproved(tokenId) == spender || isApprovedForAll(o, spender));
    }

    function _checkOnERC721Received(address from, address to, uint256 tokenId, bytes memory data)
        internal returns (bool)
    {
        if (to.code.length == 0) return true;
        try IERC721Receiver(to).onERC721Received(msg.sender, from, tokenId, data) returns (bytes4 ret) {
            return ret == IERC721Receiver.onERC721Received.selector;
        } catch {
            return false;
        }
    }

    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

interface IERC721Receiver {
    function onERC721Received(address operator, address from, uint256 tokenId, bytes calldata data)
        external returns (bytes4);
}
