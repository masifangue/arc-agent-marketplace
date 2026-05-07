// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./AgentRegistry.sol";

/**
 * @title DisputeResolver
 * @notice Decentralized dispute resolution via agent voting.
 *         When a job is disputed, registered agents can vote during a voting period.
 *         Majority determines outcome: agent gets paid or client gets refund.
 * @dev Voting period is configurable. Only registered agents can vote (1 agent = 1 vote).
 */
contract DisputeResolver is Ownable {
    // ─── Types ───────────────────────────────────────────────────────────────────

    enum DisputeStatus {
        Active,     // Voting is open
        Resolved    // Voting period ended and outcome determined
    }

    struct Dispute {
        uint256 jobId;
        uint256 agentId;
        address client;
        uint256 votesForAgent;
        uint256 votesForClient;
        uint256 votingDeadline;
        DisputeStatus status;
        bool outcomeInFavorOfAgent;
    }

    // ─── State ───────────────────────────────────────────────────────────────────

    AgentRegistry public immutable agentRegistry;
    address public marketplace;

    uint256 public votingPeriod = 5 minutes; // 5 minutes for testnet demo
    uint256 public constant MIN_QUORUM = 3;

    uint256 private _nextDisputeId = 1;
    mapping(uint256 => Dispute) private _disputes;         // disputeId => Dispute
    mapping(uint256 => uint256) public jobToDispute;       // jobId => disputeId
    mapping(uint256 => mapping(address => bool)) private _hasVoted; // disputeId => voter => voted

    // ─── Events ──────────────────────────────────────────────────────────────────

    event DisputeOpened(uint256 indexed disputeId, uint256 indexed jobId, uint256 votingDeadline);
    event VoteCast(uint256 indexed disputeId, address indexed voter, bool voteForAgent);
    event DisputeResolved(uint256 indexed disputeId, uint256 indexed jobId, bool inFavorOfAgent);
    event VotingPeriodUpdated(uint256 newPeriod);
    event MarketplaceSet(address indexed marketplace);

    // ─── Errors ──────────────────────────────────────────────────────────────────

    error NotMarketplace();
    error DisputeNotFound(uint256 disputeId);
    error DisputeNotActive(uint256 disputeId);
    error VotingPeriodEnded();
    error VotingPeriodNotEnded();
    error AlreadyVoted();
    error NotRegisteredAgent();
    error DisputeAlreadyExists(uint256 jobId);
    error SelfVoteNotAllowed();
    error InsufficientReputation();
    error QuorumNotMet();
    error VotingPeriodTooShort();

    // ─── Modifiers ───────────────────────────────────────────────────────────────

    modifier onlyMarketplace() {
        if (msg.sender != marketplace) revert NotMarketplace();
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor(address _agentRegistry) Ownable(msg.sender) {
        agentRegistry = AgentRegistry(_agentRegistry);
    }

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
     * @notice Update the voting period duration. Only owner.
     * @param _newPeriod New voting period in seconds.
     */
    function setVotingPeriod(uint256 _newPeriod) external onlyOwner {
        require(_newPeriod >= 1 minutes, "Too short");
        votingPeriod = _newPeriod;
        emit VotingPeriodUpdated(_newPeriod);
    }

    /**
     * @notice Open a new dispute for a job. Only callable by the marketplace.
     * @param jobId The job ID being disputed.
     * @param agentId The agent ID involved in the dispute.
     * @param client The client address involved in the dispute.
     * @return disputeId The newly created dispute ID.
     */
    function openDispute(uint256 jobId, uint256 agentId, address client) external onlyMarketplace returns (uint256 disputeId) {
        if (jobToDispute[jobId] != 0) revert DisputeAlreadyExists(jobId);

        disputeId = _nextDisputeId++;
        uint256 deadline = block.timestamp + votingPeriod;

        _disputes[disputeId] = Dispute({
            jobId: jobId,
            agentId: agentId,
            client: client,
            votesForAgent: 0,
            votesForClient: 0,
            votingDeadline: deadline,
            status: DisputeStatus.Active,
            outcomeInFavorOfAgent: false
        });

        jobToDispute[jobId] = disputeId;

        emit DisputeOpened(disputeId, jobId, deadline);
    }

    /**
     * @notice Cast a vote on an active dispute. Only registered agents can vote.
     * @param disputeId The dispute to vote on.
     * @param voteForAgent True = vote in favor of agent, False = vote in favor of client.
     */
    function vote(uint256 disputeId, bool voteForAgent) external {
        Dispute storage dispute = _getDispute(disputeId);

        if (dispute.status != DisputeStatus.Active) revert DisputeNotActive(disputeId);
        if (block.timestamp > dispute.votingDeadline) revert VotingPeriodEnded();
        if (_hasVoted[disputeId][msg.sender]) revert AlreadyVoted();

        // Verify voter is a registered agent owner
        uint256[] memory agentIds = agentRegistry.getAgentsByOwner(msg.sender);
        if (agentIds.length == 0) revert NotRegisteredAgent();

        // Prevent self-voting: agent owner and client cannot vote on their own dispute
        address disputeAgentOwner = agentRegistry.ownerOfAgent(dispute.agentId);
        if (msg.sender == disputeAgentOwner || msg.sender == dispute.client) revert SelfVoteNotAllowed();

        // Minimum reputation threshold: voter's agent must have reputationScore >= 0
        bool hasEligibleAgent = false;
        for (uint256 i = 0; i < agentIds.length; i++) {
            (, , , int256 repScore) = agentRegistry.getAgent(agentIds[i]);
            if (repScore >= 0) {
                hasEligibleAgent = true;
                break;
            }
        }
        if (!hasEligibleAgent) revert InsufficientReputation();

        _hasVoted[disputeId][msg.sender] = true;

        if (voteForAgent) {
            dispute.votesForAgent++;
        } else {
            dispute.votesForClient++;
        }

        emit VoteCast(disputeId, msg.sender, voteForAgent);
    }

    /**
     * @notice Resolve a dispute after the voting period has ended. Only marketplace can call.
     * @param disputeId The dispute to resolve.
     * @return inFavorOfAgent True if majority voted for agent.
     */
    function resolveDispute(uint256 disputeId) external onlyMarketplace returns (bool inFavorOfAgent) {
        Dispute storage dispute = _getDispute(disputeId);

        if (dispute.status != DisputeStatus.Active) revert DisputeNotActive(disputeId);
        if (block.timestamp <= dispute.votingDeadline) revert VotingPeriodNotEnded();

        // Enforce minimum quorum
        uint256 totalVotes = dispute.votesForAgent + dispute.votesForClient;
        if (totalVotes < MIN_QUORUM) revert QuorumNotMet();

        // Determine outcome by majority. Tie goes to client (refund).
        inFavorOfAgent = dispute.votesForAgent > dispute.votesForClient;

        dispute.status = DisputeStatus.Resolved;
        dispute.outcomeInFavorOfAgent = inFavorOfAgent;

        emit DisputeResolved(disputeId, dispute.jobId, inFavorOfAgent);
    }

    // ─── View Functions ──────────────────────────────────────────────────────────

    /**
     * @notice Get dispute details.
     * @param disputeId The dispute ID.
     */
    function getDispute(uint256 disputeId) external view returns (Dispute memory) {
        if (_disputes[disputeId].votingDeadline == 0) revert DisputeNotFound(disputeId);
        return _disputes[disputeId];
    }

    /**
     * @notice Check if an address has voted on a dispute.
     */
    function hasVoted(uint256 disputeId, address voter) external view returns (bool) {
        return _hasVoted[disputeId][voter];
    }

    // ─── Internal Functions ──────────────────────────────────────────────────────

    function _getDispute(uint256 disputeId) internal view returns (Dispute storage) {
        if (_disputes[disputeId].votingDeadline == 0) revert DisputeNotFound(disputeId);
        return _disputes[disputeId];
    }
}
