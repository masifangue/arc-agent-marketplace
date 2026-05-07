// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AgentRegistry
 * @notice Onchain AI agent identity registry with reputation scoring.
 *         Inspired by ERC-8004 agent identity standard — adapted for Arc Network.
 * @dev Each agent gets a unique auto-incremented ID, metadata URI, and reputation score.
 */
contract AgentRegistry is Ownable {
    // ─── Types ───────────────────────────────────────────────────────────────────

    struct Agent {
        address owner;
        string metadataURI;
        uint256 registeredAt;
        int256 reputationScore;
    }

    // ─── State ───────────────────────────────────────────────────────────────────

    uint256 private _nextAgentId = 1;
    mapping(uint256 => Agent) private _agents;
    mapping(address => uint256[]) private _ownerAgents;

    /// @notice Address authorized to update reputation (the marketplace contract)
    address public authorizedUpdater;

    // ─── Events ──────────────────────────────────────────────────────────────────

    event AgentRegistered(uint256 indexed agentId, address indexed owner, string metadataURI);
    event ReputationUpdated(uint256 indexed agentId, int256 newScore, int8 delta);
    event AuthorizedUpdaterSet(address indexed updater);

    // ─── Errors ──────────────────────────────────────────────────────────────────

    error AgentDoesNotExist(uint256 agentId);
    error NotAuthorizedUpdater();
    error EmptyMetadataURI();

    // ─── Constructor ─────────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── External Functions ──────────────────────────────────────────────────────

    /**
     * @notice Register a new AI agent with metadata.
     * @param metadataURI IPFS or HTTP URI pointing to agent metadata JSON.
     * @return agentId The newly assigned agent ID.
     */
    function registerAgent(string calldata metadataURI) external returns (uint256 agentId) {
        if (bytes(metadataURI).length == 0) revert EmptyMetadataURI();

        agentId = _nextAgentId++;

        _agents[agentId] = Agent({
            owner: msg.sender,
            metadataURI: metadataURI,
            registeredAt: block.timestamp,
            reputationScore: 0
        });

        _ownerAgents[msg.sender].push(agentId);

        emit AgentRegistered(agentId, msg.sender, metadataURI);
    }

    /**
     * @notice Get agent details by ID.
     * @param agentId The agent's unique identifier.
     * @return owner The agent's owner address.
     * @return metadataURI The agent's metadata URI.
     * @return registeredAt Timestamp of registration.
     * @return reputationScore The agent's current reputation score.
     */
    function getAgent(uint256 agentId)
        external
        view
        returns (address owner, string memory metadataURI, uint256 registeredAt, int256 reputationScore)
    {
        if (_agents[agentId].owner == address(0)) revert AgentDoesNotExist(agentId);

        Agent storage agent = _agents[agentId];
        return (agent.owner, agent.metadataURI, agent.registeredAt, agent.reputationScore);
    }

    /**
     * @notice Update an agent's reputation score. Only callable by the authorized marketplace.
     * @param agentId The agent to update.
     * @param delta The reputation change (+1 for good work, -1 for disputes).
     */
    function updateReputation(uint256 agentId, int8 delta) external {
        if (msg.sender != authorizedUpdater) revert NotAuthorizedUpdater();
        if (_agents[agentId].owner == address(0)) revert AgentDoesNotExist(agentId);

        _agents[agentId].reputationScore += delta;

        emit ReputationUpdated(agentId, _agents[agentId].reputationScore, delta);
    }

    /**
     * @notice Set the authorized address that can update reputation (marketplace contract).
     * @param updater The marketplace contract address.
     */
    function setAuthorizedUpdater(address updater) external onlyOwner {
        authorizedUpdater = updater;
        emit AuthorizedUpdaterSet(updater);
    }

    /**
     * @notice Get the owner of a specific agent.
     * @param agentId The agent ID to query.
     * @return The owner address.
     */
    function ownerOfAgent(uint256 agentId) external view returns (address) {
        if (_agents[agentId].owner == address(0)) revert AgentDoesNotExist(agentId);
        return _agents[agentId].owner;
    }

    /**
     * @notice Get all agent IDs owned by an address.
     * @param owner The address to query.
     * @return Array of agent IDs.
     */
    function getAgentsByOwner(address owner) external view returns (uint256[] memory) {
        return _ownerAgents[owner];
    }

    /**
     * @notice Get the total number of registered agents.
     * @return The count of registered agents.
     */
    function totalAgents() external view returns (uint256) {
        return _nextAgentId - 1;
    }
}
