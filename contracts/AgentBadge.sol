// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentBadge
 * @notice ERC-721 NFT badges awarded to agents upon job completion.
 *         Each badge records job metadata: jobId, completion timestamp, payment amount, token used.
 * @dev Only the marketplace contract can mint badges.
 */
contract AgentBadge is ERC721, Ownable {
    // ─── Types ───────────────────────────────────────────────────────────────────

    struct BadgeMetadata {
        uint256 jobId;
        uint256 completionTimestamp;
        uint256 paymentAmount;
        address tokenUsed;
    }

    // ─── State ───────────────────────────────────────────────────────────────────

    address public marketplace;

    uint256 private _nextTokenId = 1;
    mapping(uint256 => BadgeMetadata) private _badgeMetadata; // tokenId => metadata
    mapping(address => uint256) private _badgeCounts;         // agent owner => badge count

    // ─── Events ──────────────────────────────────────────────────────────────────

    event BadgeMinted(uint256 indexed tokenId, address indexed agentOwner, uint256 indexed jobId);
    event MarketplaceSet(address indexed marketplace);

    // ─── Errors ──────────────────────────────────────────────────────────────────

    error NotMarketplace();
    error BadgeNotFound(uint256 tokenId);

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor() ERC721("Agent Badge", "ABADGE") Ownable(msg.sender) {}

    // ─── External Functions ──────────────────────────────────────────────────────

    /**
     * @notice Set the marketplace contract address. Only owner.
     * @param _marketplace The marketplace contract address.
     */
    function setMarketplace(address _marketplace) external onlyOwner {
        marketplace = _marketplace;
        emit MarketplaceSet(_marketplace);
    }

    /**
     * @notice Mint a badge to an agent owner upon job completion. Only marketplace.
     * @param to The agent owner address receiving the badge.
     * @param jobId The completed job ID.
     * @param paymentAmount The payment amount for the job.
     * @param tokenUsed The payment token address used.
     * @return tokenId The minted badge token ID.
     */
    function mintBadge(
        address to,
        uint256 jobId,
        uint256 paymentAmount,
        address tokenUsed
    ) external onlyMarketplace returns (uint256 tokenId) {
        tokenId = _nextTokenId++;

        _mint(to, tokenId);

        _badgeMetadata[tokenId] = BadgeMetadata({
            jobId: jobId,
            completionTimestamp: block.timestamp,
            paymentAmount: paymentAmount,
            tokenUsed: tokenUsed
        });

        _badgeCounts[to]++;

        emit BadgeMinted(tokenId, to, jobId);
    }

    // ─── View Functions ──────────────────────────────────────────────────────────

    /**
     * @notice Get the number of badges an address holds (minted count).
     * @param agentOwner The address to query.
     * @return The badge count.
     */
    function badgeCount(address agentOwner) external view returns (uint256) {
        return _badgeCounts[agentOwner];
    }

    /**
     * @notice Get badge metadata by token ID.
     * @param tokenId The badge token ID.
     * @return The badge metadata.
     */
    function getBadgeMetadata(uint256 tokenId) external view returns (BadgeMetadata memory) {
        if (_badgeMetadata[tokenId].completionTimestamp == 0) revert BadgeNotFound(tokenId);
        return _badgeMetadata[tokenId];
    }

    /**
     * @notice Get total number of badges minted.
     * @return The total badge count.
     */
    function totalBadges() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}
