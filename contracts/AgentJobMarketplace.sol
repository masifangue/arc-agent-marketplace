// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./AgentRegistry.sol";
import "./DisputeResolver.sol";
import "./AgentBadge.sol";

/**
 * @title AgentJobMarketplace
 * @notice Multi-token escrowed job marketplace for AI agents on Arc Network.
 *         Clients post jobs with whitelisted payment tokens (USDC, EURC, etc.),
 *         agents accept and deliver, payment is released on approval.
 *         Disputes are resolved via decentralized voting. Badges are minted on completion.
 * @dev Uses SafeERC20 for token transfers. Integrates with AgentRegistry, DisputeResolver, and AgentBadge.
 */
contract AgentJobMarketplace is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Types ───────────────────────────────────────────────────────────────────

    enum JobStatus {
        Open,       // Job created and funded with token escrow
        InProgress, // Agent accepted the job
        Submitted,  // Agent submitted deliverable
        Completed,  // Client approved — tokens released to agent
        Disputed    // Client raised a dispute
    }

    struct Job {
        uint256 jobId;
        uint256 agentId;
        address client;
        uint256 budget;         // Token amount (6 decimals on Arc)
        uint256 deadline;       // Unix timestamp
        string description;
        JobStatus status;
        bytes32 deliverableHash;
        string disputeReason;
        uint256 createdAt;
        uint256 completedAt;
        address paymentToken;   // The ERC20 token used for this job
    }

    // ─── State ───────────────────────────────────────────────────────────────────

    AgentRegistry public immutable agentRegistry;
    DisputeResolver public disputeResolver;
    AgentBadge public agentBadge;

    // Multi-token whitelist
    mapping(address => bool) public allowedTokens;
    address[] private _allowedTokenList;

    uint256 private _nextJobId = 1;
    mapping(uint256 => Job) private _jobs;
    mapping(address => uint256[]) private _clientJobs;
    mapping(uint256 => uint256[]) private _agentJobs; // agentId => jobIds

    // ─── Events ──────────────────────────────────────────────────────────────────

    event JobCreated(uint256 indexed jobId, uint256 indexed agentId, address indexed client, uint256 budget);
    event JobAccepted(uint256 indexed jobId, uint256 indexed agentId);
    event DeliverableSubmitted(uint256 indexed jobId, bytes32 deliverableHash);
    event JobCompleted(uint256 indexed jobId, uint256 indexed agentId, uint256 payout);
    event JobDisputed(uint256 indexed jobId, string reason);
    event DisputeResolved(uint256 indexed jobId, bool releasedToProvider);
    event TokenAdded(address indexed token);
    event TokenRemoved(address indexed token);

    // ─── Errors ──────────────────────────────────────────────────────────────────

    error InvalidAgent(uint256 agentId);
    error InvalidBudget();
    error InvalidDeadline();
    error JobNotFound(uint256 jobId);
    error InvalidJobStatus(JobStatus current, JobStatus expected);
    error NotClient(address caller);
    error NotAgentOwner(address caller);
    error DeadlineExceeded();
    error EmptyDescription();
    error TokenNotAllowed(address token);
    error TokenAlreadyAllowed(address token);
    error DisputeResolverNotSet();

    // ─── Constructor ─────────────────────────────────────────────────────────────

    /**
     * @param _agentRegistry Address of the deployed AgentRegistry contract
     */
    constructor(address _agentRegistry) Ownable(msg.sender) {
        agentRegistry = AgentRegistry(_agentRegistry);
    }

    // ─── Admin Functions ─────────────────────────────────────────────────────────

    /**
     * @notice Add a token to the whitelist. Only owner.
     * @param token The ERC20 token address to allow.
     */
    function addAllowedToken(address token) external onlyOwner {
        if (allowedTokens[token]) revert TokenAlreadyAllowed(token);
        allowedTokens[token] = true;
        _allowedTokenList.push(token);
        emit TokenAdded(token);
    }

    /**
     * @notice Remove a token from the whitelist. Only owner.
     * @param token The ERC20 token address to remove.
     */
    function removeAllowedToken(address token) external onlyOwner {
        if (!allowedTokens[token]) revert TokenNotAllowed(token);
        allowedTokens[token] = false;
        // Remove from list
        for (uint256 i = 0; i < _allowedTokenList.length; i++) {
            if (_allowedTokenList[i] == token) {
                _allowedTokenList[i] = _allowedTokenList[_allowedTokenList.length - 1];
                _allowedTokenList.pop();
                break;
            }
        }
        emit TokenRemoved(token);
    }

    /**
     * @notice Set the DisputeResolver contract. Only owner.
     * @param _disputeResolver The DisputeResolver contract address.
     */
    function setDisputeResolver(address _disputeResolver) external onlyOwner {
        disputeResolver = DisputeResolver(_disputeResolver);
    }

    /**
     * @notice Set the AgentBadge contract. Only owner.
     * @param _agentBadge The AgentBadge contract address.
     */
    function setAgentBadge(address _agentBadge) external onlyOwner {
        agentBadge = AgentBadge(_agentBadge);
    }

    // ─── External Functions ──────────────────────────────────────────────────────

    /**
     * @notice Create a new job for a specific agent. Caller must approve token first.
     * @param agentId The target agent to perform the job.
     * @param budget Token amount to escrow for this job.
     * @param deadline Unix timestamp by which the job must be completed.
     * @param description Human-readable job description.
     * @param paymentToken The ERC20 token to use for payment (must be whitelisted).
     * @return jobId The newly created job ID.
     */
    function createJob(
        uint256 agentId,
        uint256 budget,
        uint256 deadline,
        string calldata description,
        address paymentToken
    ) external nonReentrant returns (uint256 jobId) {
        // Validate inputs
        if (agentRegistry.ownerOfAgent(agentId) == address(0)) revert InvalidAgent(agentId);
        if (budget == 0) revert InvalidBudget();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (bytes(description).length == 0) revert EmptyDescription();
        if (!allowedTokens[paymentToken]) revert TokenNotAllowed(paymentToken);

        // Transfer token from client to this contract (escrow)
        IERC20(paymentToken).safeTransferFrom(msg.sender, address(this), budget);

        jobId = _nextJobId++;

        _jobs[jobId] = Job({
            jobId: jobId,
            agentId: agentId,
            client: msg.sender,
            budget: budget,
            deadline: deadline,
            description: description,
            status: JobStatus.Open,
            deliverableHash: bytes32(0),
            disputeReason: "",
            createdAt: block.timestamp,
            completedAt: 0,
            paymentToken: paymentToken
        });

        _clientJobs[msg.sender].push(jobId);
        _agentJobs[agentId].push(jobId);

        emit JobCreated(jobId, agentId, msg.sender, budget);
    }

    /**
     * @notice Agent owner accepts a job, moving it to InProgress.
     * @param jobId The job to accept.
     */
    function acceptJob(uint256 jobId) external {
        Job storage job = _getJob(jobId);

        if (job.status != JobStatus.Open) {
            revert InvalidJobStatus(job.status, JobStatus.Open);
        }

        address agentOwner = agentRegistry.ownerOfAgent(job.agentId);
        if (msg.sender != agentOwner) revert NotAgentOwner(msg.sender);

        job.status = JobStatus.InProgress;

        emit JobAccepted(jobId, job.agentId);
    }

    /**
     * @notice Agent submits a deliverable hash as proof of work.
     * @param jobId The job to submit for.
     * @param deliverableHash Hash of the deliverable (e.g., IPFS CID hash).
     */
    function submitDeliverable(uint256 jobId, bytes32 deliverableHash) external {
        Job storage job = _getJob(jobId);

        if (job.status != JobStatus.InProgress) {
            revert InvalidJobStatus(job.status, JobStatus.InProgress);
        }

        address agentOwner = agentRegistry.ownerOfAgent(job.agentId);
        if (msg.sender != agentOwner) revert NotAgentOwner(msg.sender);
        if (block.timestamp > job.deadline) revert DeadlineExceeded();

        job.status = JobStatus.Submitted;
        job.deliverableHash = deliverableHash;

        emit DeliverableSubmitted(jobId, deliverableHash);
    }

    /**
     * @notice Client approves the deliverable, releasing tokens to the agent owner.
     *         Also mints an NFT badge to the agent owner.
     * @param jobId The job to approve.
     */
    function approveDeliverable(uint256 jobId) external nonReentrant {
        Job storage job = _getJob(jobId);

        if (job.status != JobStatus.Submitted) {
            revert InvalidJobStatus(job.status, JobStatus.Submitted);
        }
        if (msg.sender != job.client) revert NotClient(msg.sender);

        job.status = JobStatus.Completed;
        job.completedAt = block.timestamp;

        // Release tokens to agent owner
        address agentOwner = agentRegistry.ownerOfAgent(job.agentId);
        IERC20(job.paymentToken).safeTransfer(agentOwner, job.budget);

        // Update agent reputation (+1)
        agentRegistry.updateReputation(job.agentId, 1);

        // Mint NFT badge
        if (address(agentBadge) != address(0)) {
            agentBadge.mintBadge(agentOwner, jobId, job.budget, job.paymentToken);
        }

        emit JobCompleted(jobId, job.agentId, job.budget);
    }

    /**
     * @notice Client disputes a submitted job. Opens a dispute in DisputeResolver.
     * @param jobId The job to dispute.
     * @param reason Human-readable reason for the dispute.
     */
    function disputeJob(uint256 jobId, string calldata reason) external {
        Job storage job = _getJob(jobId);

        if (job.status != JobStatus.Submitted) {
            revert InvalidJobStatus(job.status, JobStatus.Submitted);
        }
        if (msg.sender != job.client) revert NotClient(msg.sender);

        job.status = JobStatus.Disputed;
        job.disputeReason = reason;

        // Open dispute in DisputeResolver if set
        if (address(disputeResolver) != address(0)) {
            disputeResolver.openDispute(jobId);
        }

        emit JobDisputed(jobId, reason);
    }

    /**
     * @notice Resolve a dispute after voting has concluded in DisputeResolver.
     *         Anyone can call this to finalize the dispute resolution.
     * @param jobId The disputed job.
     */
    function resolveDisputeVoting(uint256 jobId) external nonReentrant {
        Job storage job = _getJob(jobId);

        if (job.status != JobStatus.Disputed) {
            revert InvalidJobStatus(job.status, JobStatus.Disputed);
        }
        if (address(disputeResolver) == address(0)) revert DisputeResolverNotSet();

        uint256 disputeId = disputeResolver.jobToDispute(jobId);
        bool inFavorOfAgent = disputeResolver.resolveDispute(disputeId);

        job.status = JobStatus.Completed;
        job.completedAt = block.timestamp;

        if (inFavorOfAgent) {
            // Pay the agent
            address agentOwner = agentRegistry.ownerOfAgent(job.agentId);
            IERC20(job.paymentToken).safeTransfer(agentOwner, job.budget);
            agentRegistry.updateReputation(job.agentId, 1);

            // Mint badge on agent win
            if (address(agentBadge) != address(0)) {
                agentBadge.mintBadge(agentOwner, jobId, job.budget, job.paymentToken);
            }
        } else {
            // Refund the client
            IERC20(job.paymentToken).safeTransfer(job.client, job.budget);
            agentRegistry.updateReputation(job.agentId, -1);
        }

        emit DisputeResolved(jobId, inFavorOfAgent);
    }

    /**
     * @notice Admin resolves a dispute — either releases funds to agent or refunds client.
     *         This is the fallback admin resolution (kept for backward compatibility).
     * @param jobId The disputed job.
     * @param releaseToProvider If true, pay the agent. If false, refund the client.
     */
    function resolveDispute(uint256 jobId, bool releaseToProvider) external onlyOwner nonReentrant {
        Job storage job = _getJob(jobId);

        if (job.status != JobStatus.Disputed) {
            revert InvalidJobStatus(job.status, JobStatus.Disputed);
        }

        job.status = JobStatus.Completed;
        job.completedAt = block.timestamp;

        if (releaseToProvider) {
            // Pay the agent
            address agentOwner = agentRegistry.ownerOfAgent(job.agentId);
            IERC20(job.paymentToken).safeTransfer(agentOwner, job.budget);
            agentRegistry.updateReputation(job.agentId, 1);

            // Mint badge
            if (address(agentBadge) != address(0)) {
                agentBadge.mintBadge(agentOwner, jobId, job.budget, job.paymentToken);
            }
        } else {
            // Refund the client
            IERC20(job.paymentToken).safeTransfer(job.client, job.budget);
            agentRegistry.updateReputation(job.agentId, -1);
        }

        emit DisputeResolved(jobId, releaseToProvider);
    }

    // ─── View Functions ──────────────────────────────────────────────────────────

    /**
     * @notice Get full job details.
     * @param jobId The job ID to query.
     * @return The Job struct.
     */
    function getJob(uint256 jobId) external view returns (Job memory) {
        if (_jobs[jobId].client == address(0)) revert JobNotFound(jobId);
        return _jobs[jobId];
    }

    /**
     * @notice Get all job IDs created by a client.
     * @param client The client address.
     * @return Array of job IDs.
     */
    function getJobsByClient(address client) external view returns (uint256[] memory) {
        return _clientJobs[client];
    }

    /**
     * @notice Get all job IDs assigned to an agent.
     * @param agentId The agent ID.
     * @return Array of job IDs.
     */
    function getJobsByAgent(uint256 agentId) external view returns (uint256[] memory) {
        return _agentJobs[agentId];
    }

    /**
     * @notice Get total number of jobs created.
     * @return The job count.
     */
    function totalJobs() external view returns (uint256) {
        return _nextJobId - 1;
    }

    /**
     * @notice Get all allowed token addresses.
     * @return Array of allowed token addresses.
     */
    function getAllowedTokens() external view returns (address[] memory) {
        return _allowedTokenList;
    }

    // ─── Internal Functions ──────────────────────────────────────────────────────

    function _getJob(uint256 jobId) internal view returns (Job storage) {
        if (_jobs[jobId].client == address(0)) revert JobNotFound(jobId);
        return _jobs[jobId];
    }
}
